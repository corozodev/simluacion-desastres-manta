package floodlab

import "net/http"

// Report permissions reuse the existing privileged operator role. Development
// cookies and anonymous storm controls never grant that role. Official backing
// is a separate action requiring an explicit documentary attestation as well.
type incidentPermissions struct {
	CanReview              bool `json:"can_review"`
	CanWithdraw            bool `json:"can_withdraw"`
	CanMarkOfficial        bool `json:"can_mark_official"`
	OperatorLoginAvailable bool `json:"operator_login_available"`
}

func (m *Manager) incidentModerationPermissions(r *http.Request) incidentPermissions {
	result := incidentPermissions{OperatorLoginAvailable: m.operatorSessionURL != ""}
	if !result.OperatorLoginAvailable {
		return result
	}
	state, err := m.operatorSession(r)
	if err != nil || !state.Authenticated || state.CSRFToken == "" {
		return result
	}
	result.CanReview, result.CanWithdraw, result.CanMarkOfficial = true, true, true
	return result
}
