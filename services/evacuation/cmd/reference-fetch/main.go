// Explicit opt-in acquisition; never called from a simulation step or HTTP GET.
package main

import (
	"context"
	"corodev/evacuation/internal/reference"
	"flag"
	"fmt"
	"os"
	"time"
)

func main() {
	output := flag.String("output", "private/reference.json", "validated local snapshot")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	client := reference.NewClient()
	bundle, err := client.Fetch(ctx)
	if err == nil {
		err = reference.Write(*output, bundle)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		fmt.Fprintf(os.Stderr, "provider queries=%d errors=%d bytes=%d last_ms=%.2f\n", client.Metrics().Queries, client.Metrics().ProviderErrors, client.Metrics().ResponseBytes, client.Metrics().LastQueryMS)
		os.Exit(1)
	}
	fmt.Printf("reference=%s polygons=%d vertices=%d historical_events=%d version=%s\n", *output, bundle.Susceptibility.FeatureCount, bundle.Susceptibility.VertexCount, len(bundle.RainEvents.Events), bundle.Susceptibility.Provenance.DatasetVersion)
}
