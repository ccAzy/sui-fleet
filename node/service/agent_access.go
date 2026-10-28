package service

import "github.com/alireza0/s-ui/core"

// CoreInstance exposes the process-wide core handle for agent mode
// (cmd/agent.go), which lives outside this package and cannot read corePtr.
// Panel mode never calls it.
func CoreInstance() *core.Core {
	return corePtr
}
