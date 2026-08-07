# Third-Party Notices

This file lists third-party software whose design or code Synara incorporates,
together with the notices their licenses require.

---

## oh-my-pi

Synara's agent daemon subsystem (`apps/server/src/daemon/`) and its agent-facing
daemon tools are a reimplementation of the `hub` tool and `DaemonBroker` from
[can1357/oh-my-pi](https://github.com/can1357/oh-my-pi). The daemon spec, state
machine, readiness probes, restart backoff, detached survival, log cursor
semantics, and operation set follow that project's design.

The work here is a reimplementation on a different stack (Effect, node-pty, and
Synara's existing terminal manager) rather than a line-by-line copy.

```
MIT License

Copyright (c) can1357

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
