package floodlab

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/control"
	"corodev/evacuation/internal/incidents"
)

// Exercise the production identity bridge with both real HTTP handlers. The
// laboratory keeps identity only for protected tools; storm controls are public.
func TestOperatorIdentityRemainsScopedToProtectedTools(t *testing.T) {
	const origin = "https://operator.example"
	var entropy [32]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		t.Fatal(err)
	}
	code := base64.RawURLEncoding.EncodeToString(entropy[:])
	hash := sha256.Sum256([]byte(code))
	graphs, err := catalog.New("../../data", "../../scenarios/urban", catalog.Options{Concurrency: 4})
	if err != nil {
		t.Fatal(err)
	}
	operator, err := control.New(graphs, control.Options{DisableStart: true, APIKey: "test-only-independent-movement-key", Origins: []string{origin}, Admin: control.AdminOptions{Operator: "operator", AccessHash: hex.EncodeToString(hash[:])}})
	if err != nil {
		t.Fatal(err)
	}
	defer operator.Close()
	identity := httptest.NewServer(operator)
	defer identity.Close()
	lab := newManager(t)
	lab.origins = []string{origin}
	// Production uses its fixed private loopback endpoint; an ephemeral port
	// isolates the test while exercising the same bridge implementation.
	lab.operatorSessionURL = identity.URL + "/admin/session"
	server := httptest.NewServer(lab)
	defer server.Close()
	store := managerStore(t, lab)
	incident, _, err := store.Create(roadReport(t, lab), "operator_review_http_12345", "citizen", "operator-review-test")
	if err != nil {
		t.Fatal(err)
	}
	statusPath := "/lab/incidents/" + incident.IncidentID + "/status"
	request := func(base, method, path string, body any, cookie *http.Cookie, csrf string) (*http.Response, []byte) {
		t.Helper()
		var encoded []byte
		if body != nil {
			encoded, _ = json.Marshal(body)
		}
		req, err := http.NewRequest(method, base+path, bytes.NewReader(encoded))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Origin", origin)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		if csrf != "" {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		return response, raw
	}
	response, raw := request(server.URL, "GET", "/lab/session", nil, nil, "")
	var session Session
	if response.StatusCode != 200 || json.Unmarshal(raw, &session) != nil || !session.Enabled || session.Authenticated || session.CSRFToken != "" || len(response.Cookies()) != 0 {
		t.Fatal("unauthenticated request acquired control")
	}
	response, _ = request(server.URL, "POST", statusPath, incidents.StatusUpdate{VerificationStatus: "verified", ExpectedUpdatedAt: incident.UpdatedAt}, nil, "")
	if response.StatusCode != 401 {
		t.Fatal("anonymous caller acquired moderation")
	}
	response, raw = request(identity.URL, "POST", "/admin/session", map[string]string{"operator": "operator", "access_code": code}, nil, "")
	if response.StatusCode != 200 || len(response.Cookies()) != 1 || bytes.Contains(raw, []byte(code)) {
		t.Fatal("operator login failed or exposed access code")
	}
	cookie := response.Cookies()[0]
	if cookie.Name != "__Host-corodev_admin" || !cookie.Secure || !cookie.HttpOnly {
		t.Fatal("production cookie protections missing")
	}
	response, raw = request(server.URL, "GET", "/lab/session", nil, cookie, "")
	if response.StatusCode != 200 || json.Unmarshal(raw, &session) != nil || !session.Authenticated || session.CSRFToken == "" {
		t.Fatal("laboratory did not recognize operator identity")
	}
	response, raw = request(server.URL, "POST", statusPath, incidents.StatusUpdate{VerificationStatus: "verified", ExpectedUpdatedAt: incident.UpdatedAt}, cookie, session.CSRFToken)
	var reviewed incidents.Incident
	if response.StatusCode != 200 || json.Unmarshal(raw, &reviewed) != nil || reviewed.VerificationStatus != "verified" || reviewed.SourceType != "citizen" || reviewed.OfficialSource != nil {
		t.Fatal("authenticated moderation failed or forged official provenance", response.StatusCode, string(raw))
	}
	response, _ = request(server.URL, "POST", statusPath, incidents.StatusUpdate{VerificationStatus: "rejected", ExpectedUpdatedAt: incident.UpdatedAt}, cookie, session.CSRFToken)
	if response.StatusCode != 409 {
		t.Fatal("stale authenticated review overwrote newer moderation")
	}
	cfg := compactConfig(lab)
	cfg.IntervalMS = 2000
	response, _ = request(server.URL, "POST", "/lab/incidents/synthetic", map[string]string{}, cookie, "forged")
	if response.StatusCode != 401 {
		t.Fatal("laboratory accepted forged csrf")
	}
	response, raw = request(server.URL, "POST", "/lab/runs", RunRequest{Config: cfg, ExpectedRunID: lab.State().RunID}, cookie, session.CSRFToken)
	var running State
	if response.StatusCode != 200 || json.Unmarshal(raw, &running) != nil || running.State != "running" {
		t.Fatal("authenticated storm did not start", response.StatusCode)
	}
	response, _ = request(identity.URL, "DELETE", "/admin/session", nil, cookie, session.CSRFToken)
	if response.StatusCode != 200 {
		t.Fatal("operator logout failed")
	}
	response, raw = request(server.URL, "GET", "/lab/session", nil, cookie, "")
	if response.StatusCode != 200 || json.Unmarshal(raw, &session) != nil || session.Authenticated {
		t.Fatal("revoked identity retained control")
	}
	response, _ = request(server.URL, "POST", "/lab/actions", Action{Action: "pause", ExpectedRunID: running.RunID}, cookie, session.CSRFToken)
	if response.StatusCode != 200 {
		t.Fatal("storm control still requires operator identity")
	}
	response, _ = request(server.URL, "POST", "/lab/incidents/synthetic", map[string]string{}, cookie, session.CSRFToken)
	if response.StatusCode != 401 {
		t.Fatal("revoked identity retained protected incident tools")
	}
	response, _ = request(server.URL, "POST", statusPath, incidents.StatusUpdate{VerificationStatus: "rejected", ExpectedUpdatedAt: reviewed.UpdatedAt}, cookie, session.CSRFToken)
	if response.StatusCode != 401 {
		t.Fatal("revoked identity retained moderation")
	}
}
