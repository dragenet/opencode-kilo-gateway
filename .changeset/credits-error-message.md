---
"@dragenetlabs/opencode-kilo-gateway": patch
---

Make Kilo's out-of-credits failure actionable. A `402` with
`error_type: usage_limit_exceeded` / `title: "Paid Model - Credits Required"` now carries a
rewritten `error.message` naming the requested model, the remaining balance and the top-up
URL, instead of only "Add credits to continue, or switch to a free model". Status code, body
shape and every other response are left untouched, and nothing is retried or downgraded.
Implemented in the v2 `http.response` hook; the v1 plugin API has no response hook, so v1
behaviour is unchanged.
