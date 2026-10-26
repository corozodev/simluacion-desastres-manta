package simulation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"corodev/evacuation/internal/world"
)

var ErrInvalidDecision = errors.New("invalid decision response")

type DecisionClient interface {
	NextStep(context.Context, world.StepRequest) (world.StepResponse, error)
}

// HTTPDecisionClient sends the exact competition contract; credentials stay on
// the server. Timeout includes connection, headers, reading and decoding.
type HTTPDecisionClient struct {
	url     string
	apiKey  string
	client  *http.Client
	timeout time.Duration
}

func NewHTTPDecisionClient(baseURL, apiKey string, timeout time.Duration) (*HTTPDecisionClient, error) {
	u, err := url.Parse(baseURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("decision URL must be an HTTP(S) base URL without credentials, query or fragment")
	}
	if apiKey == "" {
		return nil, fmt.Errorf("decision API key is required")
	}
	if timeout <= 0 || timeout > 500*time.Millisecond {
		timeout = 500 * time.Millisecond
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 256
	transport.MaxIdleConnsPerHost = 200
	return &HTTPDecisionClient{
		url: strings.TrimRight(baseURL, "/") + "/paso", apiKey: apiKey,
		client: &http.Client{Timeout: timeout, Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse // Never forward the API key to a redirect.
		}}, timeout: timeout,
	}, nil
}

func (c *HTTPDecisionClient) CloseIdleConnections() { c.client.CloseIdleConnections() }

func (c *HTTPDecisionClient) NextStep(ctx context.Context, request world.StepRequest) (world.StepResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	body, err := json.Marshal(request)
	if err != nil {
		return world.StepResponse{}, err
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return world.StepResponse{}, err
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json")
	r.Header.Set("x-api-key", c.apiKey)
	response, err := c.client.Do(r)
	if err != nil {
		return world.StepResponse{}, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusRequestTimeout || response.StatusCode == http.StatusGatewayTimeout {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return world.StepResponse{}, fmt.Errorf("decision service timeout: %w", context.DeadlineExceeded)
	}
	if response.StatusCode != http.StatusOK {
		if _, err := io.Copy(io.Discard, io.LimitReader(response.Body, 4096)); err != nil {
			return world.StepResponse{}, responseReadError(ctx, err, "error body unavailable")
		}
		if err := ctx.Err(); err != nil {
			return world.StepResponse{}, err
		}
		return world.StepResponse{}, fmt.Errorf("%w: HTTP %d", ErrInvalidDecision, response.StatusCode)
	}
	var result struct {
		NextNode *string `json:"siguienteNodo"`
	}
	d := json.NewDecoder(io.LimitReader(response.Body, 4097))
	d.DisallowUnknownFields()
	if err := d.Decode(&result); err != nil {
		return world.StepResponse{}, responseReadError(ctx, err, "malformed JSON")
	}
	if err := ctx.Err(); err != nil {
		return world.StepResponse{}, err
	}
	if result.NextNode == nil || *result.NextNode == "" {
		return world.StepResponse{}, fmt.Errorf("%w: missing siguienteNodo", ErrInvalidDecision)
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return world.StepResponse{}, responseReadError(ctx, err, "trailing JSON")
	}
	if err := ctx.Err(); err != nil {
		return world.StepResponse{}, err
	}
	return world.StepResponse{NextNode: *result.NextNode}, nil
}

// A read deadline can happen after successful headers, including while waiting
// for EOF after an otherwise valid JSON object. Preserve timeout identity rather
// than describing transport failures as malformed decision data.
func responseReadError(ctx context.Context, err error, reason string) error {
	if contextError := ctx.Err(); contextError != nil {
		return contextError
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return fmt.Errorf("decision response read timeout: %w", err)
	}
	return fmt.Errorf("%w: %s", ErrInvalidDecision, reason)
}
