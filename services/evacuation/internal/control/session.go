package control

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

type AdminOptions struct {
	Operator              string
	AccessHash            string
	AllowInsecureLoopback bool
	SessionTTL            time.Duration
}

type SessionState struct {
	Enabled       bool   `json:"enabled"`
	Authenticated bool   `json:"authenticated"`
	Operator      string `json:"operator,omitempty"`
	CSRFToken     string `json:"csrf_token,omitempty"`
	ExpiresAt     string `json:"expires_at,omitempty"`
}

type session struct {
	operator, csrf string
	expires        time.Time
}

type sessions struct {
	mu         sync.Mutex
	enabled    bool
	operator   string
	hash       [32]byte
	secure     bool
	cookieName string
	ttl        time.Duration
	items      map[[32]byte]session
	attempts   int
	window     time.Time
}

func newSessions(options AdminOptions, origins []string) (*sessions, error) {
	s := &sessions{items: map[[32]byte]session{}, secure: !options.AllowInsecureLoopback, cookieName: "__Host-corodev_admin", ttl: time.Hour}
	if options.Operator == "" && options.AccessHash == "" {
		return s, nil
	}
	if !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$`).MatchString(options.Operator) {
		return nil, errors.New("invalid admin operator identifier")
	}
	raw, err := hex.DecodeString(options.AccessHash)
	if err != nil || len(raw) != 32 {
		return nil, errors.New("ADMIN_ACCESS_HASH must contain a SHA-256 verifier")
	}
	if len(origins) == 0 {
		return nil, errors.New("admin requires explicit browser origins")
	}
	for _, value := range origins {
		u, err := url.Parse(strings.TrimSpace(value))
		if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, errors.New("invalid admin origin")
		}
		if u.Scheme != "https" {
			ip := net.ParseIP(u.Hostname())
			local := u.Hostname() == "localhost" || ip != nil && ip.IsLoopback()
			if !options.AllowInsecureLoopback || u.Scheme != "http" || !local {
				return nil, errors.New("admin origins require HTTPS; explicit local development is loopback only")
			}
		}
	}
	if options.AllowInsecureLoopback {
		s.cookieName = "corodev_dev_admin"
	}
	if options.SessionTTL != 0 {
		if options.SessionTTL < time.Minute || options.SessionTTL > 4*time.Hour {
			return nil, errors.New("invalid admin session lifetime")
		}
		s.ttl = options.SessionTTL
	}
	copy(s.hash[:], raw)
	s.operator = options.Operator
	s.enabled = true
	return s, nil
}

func randomToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func (s *sessions) authenticate(operator, code string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(code)
	if err != nil || len(raw) != 32 || len(code) != 43 {
		return false
	}
	supplied := sha256.Sum256([]byte(code))
	user := sha256.Sum256([]byte(operator))
	expectedUser := sha256.Sum256([]byte(s.operator))
	return subtle.ConstantTimeCompare(supplied[:], s.hash[:]) == 1 && subtle.ConstantTimeCompare(user[:], expectedUser[:]) == 1
}

func (s *sessions) attemptAllowed(now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if now.Sub(s.window) >= time.Minute {
		s.window = now
		s.attempts = 0
	}
	if s.attempts >= 10 {
		return false
	}
	s.attempts++
	return true
}

func (s *sessions) create(w http.ResponseWriter) (SessionState, error) {
	token, err := randomToken()
	if err != nil {
		return SessionState{}, err
	}
	csrf, err := randomToken()
	if err != nil {
		return SessionState{}, err
	}
	now := time.Now()
	entry := session{operator: s.operator, csrf: csrf, expires: now.Add(s.ttl)}
	s.mu.Lock()
	for id, current := range s.items {
		if !now.Before(current.expires) {
			delete(s.items, id)
		}
	}
	if len(s.items) >= 8 {
		var oldest [32]byte
		var expiry time.Time
		for id, current := range s.items {
			if expiry.IsZero() || current.expires.Before(expiry) {
				oldest, expiry = id, current.expires
			}
		}
		delete(s.items, oldest)
	}
	s.items[sha256.Sum256([]byte(token))] = entry
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: s.cookieName, Value: token, Path: "/", Secure: s.secure, HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: int(s.ttl.Seconds()), Expires: entry.expires})
	return SessionState{Enabled: true, Authenticated: true, Operator: entry.operator, CSRFToken: entry.csrf, ExpiresAt: entry.expires.UTC().Format(time.RFC3339Nano)}, nil
}

func (s *sessions) read(r *http.Request) (SessionState, bool) {
	if !s.enabled {
		return SessionState{Enabled: false, Authenticated: false}, false
	}
	cookie, err := r.Cookie(s.cookieName)
	if err != nil || len(cookie.Value) != 43 {
		return SessionState{Enabled: true, Authenticated: false}, false
	}
	id := sha256.Sum256([]byte(cookie.Value))
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.items[id]
	if !ok || !time.Now().Before(entry.expires) {
		delete(s.items, id)
		return SessionState{Enabled: true, Authenticated: false}, false
	}
	return SessionState{Enabled: true, Authenticated: true, Operator: entry.operator, CSRFToken: entry.csrf, ExpiresAt: entry.expires.UTC().Format(time.RFC3339Nano)}, true
}

func validCSRF(r *http.Request, state SessionState) bool {
	expected := sha256.Sum256([]byte(state.CSRFToken))
	supplied := sha256.Sum256([]byte(r.Header.Get("X-CSRF-Token")))
	return state.Authenticated && state.CSRFToken != "" && subtle.ConstantTimeCompare(expected[:], supplied[:]) == 1
}

func (s *sessions) revoke(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(s.cookieName); err == nil {
		s.mu.Lock()
		delete(s.items, sha256.Sum256([]byte(cookie.Value)))
		s.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: s.cookieName, Value: "", Path: "/", Secure: s.secure, HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1, Expires: time.Unix(1, 0)})
}
