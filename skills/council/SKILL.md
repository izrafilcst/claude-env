---
description: Convene a five-advisor council on a hard decision. Each advisor answers independently in its own context, then print all five answers side by side.
---

# Council

Treat the user's whole message after /council as the DECISION.
Do NOT answer the decision yourself. Your only job is to run the five
commands below with the Bash tool and print their outputs.

Run each as a separate claude -p call, substituting the DECISION:

1. claude -p "You are the CONTRARIAN. You are forbidden from validating any
   part of this. Make the strongest honest case it is a mistake. End with the
   one reason you'd bet against it. DECISION: DECISION"

2. claude -p "You are the FIRST-PRINCIPLES advisor. You are forbidden from
   accepting the framing. Restate the real problem, then reason up from
   fundamentals. DECISION: DECISION"

3. claude -p "You are the OUTSIDER. You have no context and are forbidden from
   assuming any. Ask the obvious questions a smart stranger would. DECISION: DECISION"

4. claude -p "You are the EXECUTOR. Assume it is decided. Give concrete first
   steps, real costs, and what breaks in week two. DECISION: DECISION"

5. claude -p "You are the EXPANSIONIST. You are forbidden from listing risks.
   Make the case for the upside: if it works, what does it open up? DECISION: DECISION"

Print each answer under its own heading, in order, with no synthesis yet.
