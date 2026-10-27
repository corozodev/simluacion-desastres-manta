// Command operator-key writes a distinct 256-bit administrative access code and
// its server verifier to private files. It never prints either secret to logs.
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

func run() error {
	operator := flag.String("operator", "operator", "audit identity")
	directory := flag.String("directory", "", "new private output directory, outside Git")
	flag.Parse()
	if *directory == "" || !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$`).MatchString(*operator) {
		return errors.New("require a private directory and valid operator identifier")
	}
	if err := os.Mkdir(*directory, 0700); err != nil {
		return errors.New("output directory must be new")
	}
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return err
	}
	code := base64.RawURLEncoding.EncodeToString(raw[:])
	hash := sha256.Sum256([]byte(code))
	env := []byte("ADMIN_OPERATOR=" + *operator + "\nADMIN_ACCESS_HASH=" + hex.EncodeToString(hash[:]) + "\n")
	credentials, _ := json.MarshalIndent(map[string]string{"operator": *operator, "access_code": code}, "", "  ")
	for name, data := range map[string][]byte{"operator.env": env, "operator-login.json": append(credentials, '\n')} {
		path := filepath.Join(*directory, name)
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, err = f.Write(data)
		closeErr := f.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	fmt.Println("Private operator files created; do not commit or send their contents to chat.")
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
