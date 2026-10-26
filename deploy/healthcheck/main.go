// A shell-free health probe for the non-root backend container.
package main

import (
	"encoding/json"
	"net/http"
	"os"
	"time"
)

func main() {
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get("http://127.0.0.1:8080/healthz")
	if err != nil {
		os.Exit(1)
	}
	defer response.Body.Close()
	var body struct {
		Status string `json:"status"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&body) != nil || body.Status != "ok" {
		os.Exit(1)
	}
}
