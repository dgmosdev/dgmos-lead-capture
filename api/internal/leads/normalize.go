package leads

import "strings"

type Lead struct {
	Name         string `json:"name"`
	ProfileURL   string `json:"profile_url"`
	LinkedInURL  string `json:"linkedin_url"`
	Title        string `json:"title"`
	Company      string `json:"company"`
	Location     string `json:"location"`
	Email        string `json:"email"`
	Phone        string `json:"phone"`
	Website      string `json:"website"`
	Headline     string `json:"headline"`
	About        string `json:"about"`
	EnrichStatus string `json:"enrich_status,omitempty"`
	AIStatus     string `json:"ai_status,omitempty"`
}

const MaxBatch = 100

const (
	EnrichListed   = "listed"
	EnrichEnriched = "enriched"
	AINone         = "none"
	AIPending      = "pending"
	AIDone         = "done"
	AISkipped      = "skipped"
)

func Normalize(in Lead) Lead {
	profile := strings.TrimSpace(in.ProfileURL)
	if profile == "" {
		profile = strings.TrimSpace(in.LinkedInURL)
	}
	name := strings.TrimSpace(in.Name)
	company := strings.TrimSpace(in.Company)
	if name == "" {
		name = company
	}
	out := Lead{
		Name:        name,
		ProfileURL:  strings.TrimRight(profile, "/"),
		LinkedInURL: strings.TrimRight(strings.TrimSpace(in.LinkedInURL), "/"),
		Title:       strings.TrimSpace(in.Title),
		Company:     company,
		Location:    strings.TrimSpace(in.Location),
		Email:       strings.ToLower(strings.TrimSpace(in.Email)),
		Phone:       strings.TrimSpace(in.Phone),
		Website:     strings.TrimSpace(in.Website),
		Headline:    strings.TrimSpace(in.Headline),
		About:       strings.TrimSpace(in.About),
		AIStatus:    normalizeAIStatus(in.AIStatus),
	}
	out.EnrichStatus = DeriveEnrichStatus(out)
	return out
}

func normalizeAIStatus(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case AIPending, AIDone, AISkipped:
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return AINone
	}
}

// DeriveEnrichStatus marks a lead enriched when detail fields are present.
func DeriveEnrichStatus(lead Lead) string {
	if lead.About != "" || lead.Email != "" || lead.Phone != "" {
		return EnrichEnriched
	}
	if strings.Contains(strings.ToLower(lead.ProfileURL), "/company/") && lead.Website != "" {
		return EnrichEnriched
	}
	if strings.EqualFold(strings.TrimSpace(lead.EnrichStatus), EnrichEnriched) {
		return EnrichEnriched
	}
	return EnrichListed
}

// Valid returns true when the lead has a profile URL and a name or company.
func Valid(lead Lead) bool {
	if lead.ProfileURL == "" {
		return false
	}
	return lead.Name != "" || lead.Company != ""
}
