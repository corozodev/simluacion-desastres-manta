package floodlab

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

// Production reuses the already configured operator identity, cookie and CSRF.
// Both processes share a private network namespace; no credential is copied.
func (m *Manager) ConfigureOperatorSession(endpoint string) error {
	if endpoint != "" && endpoint != "http://127.0.0.1:8080/admin/session" {
		return errors.New("operator session endpoint must be the private local controller")
	}
	m.operatorSessionURL = endpoint
	return nil
}
func (m *Manager) operatorSession(r *http.Request) (Session, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, m.operatorSessionURL, nil)
	if err != nil {
		return Session{}, err
	}
	if cookie, e := r.Cookie("__Host-corodev_admin"); e == nil {
		req.AddCookie(cookie)
	}
	req.Header.Set("Origin", r.Header.Get("Origin"))
	client := http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return Session{}, err
	}
	defer response.Body.Close()
	var state Session
	if response.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&state) != nil {
		return Session{}, errors.New("operator session unavailable")
	}
	return state, nil
}
