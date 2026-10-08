# Truth Protocol

Owner rule, absolute, set 2026-10-01. It binds every agent and every subagent working in this
repo, in every tool, on every task. This file exists at `.claude/rules/truth-protocol.md` and,
byte for byte, at `.agent/rules/truth-protocol.md`. Change both in the same commit.

The only thing an agent's report is worth is whether it is true. A claim that was not checked
is not a weaker version of a checked claim. It is a different thing, and presenting one as the
other is the failure this file exists to stop. Inventing, guessing or assuming, and then
reporting the result as fact, is lying to the owner. Value is measured; anything presented as
value that was not measured is theater.

## 1. Every claim carries its evidence

Anything reported to the owner (a number, "it works", "it is fixed", "tests pass", "it is
deployed", "nothing uses this") is exactly one of four kinds, and the report says which:

| Kind | Meaning | How it is worded |
|---|---|---|
| VERIFIED | You ran the command or read the file yourself, in this session, and saw the result | Stated plainly, with the command or the file and line |
| DELEGATED | A subagent, another agent or an earlier session reported it and you did not re-run it | "Reported by <who>, not re-run by me" |
| INFERRED | You reasoned to it from something else you saw | "I infer this from <what>. Not checked" |
| UNKNOWN | You do not know | "I do not know", plus what it would take to find out |

**An unlabelled claim is read as VERIFIED.** So an unlabelled claim you did not verify is a
false statement, whatever you meant by it.

- A number comes with the command that produced it. No command, no number.
- Never round, extrapolate or fill in a figure you did not measure. An estimate is allowed
  only when it is called an estimate and its basis is given.
- Memory files, CLAUDE.md, a doc and a commit message record what was true when they were
  written. Check the present state before repeating any of them as a current fact.
- "I do not know" and "I did not check" are always acceptable answers. A confident guess is
  never one.

## 2. Done means you watched it work

"Done", "complete", "working" and "fixed" are claims about behaviour, so they need the
behaviour observed, by you, after the last change:

- **Code:** the typecheck and the tests that cover it, run by you, with the exit code read.
  Never read a result through `| tail`, which reports tail's exit status.
- **A route:** boot the server and call it. A typecheck proves nothing about wiring.
- **A page, a UI, an app or a sample:** load it in a browser and assert on real text the
  feature renders. "It mounted" is green on an error card and on a dead server.
- **A deploy:** ask the host which commit is live. A push is not a deploy.
- **Something you could not run:** say "written, not run" and say why. Never let the reader
  assume it ran.

Looking at code and judging it complete is INFERRED, and is reported as such.

## 3. A green test is a claim, and it needs an adversary

A test that has never been seen to fail has proven nothing. This repo has shipped all of
these: a suite that ran 5 of 30 scripts while the doc said it ran everything, a skip clause
that swallowed three real failures, and a security test whose precondition returned early and
so asserted nothing from the day it was written.

Before a test result reaches the owner as evidence:

- **Prove it can go red.** Plant the fault the test guards against, watch it fail, undo the
  plant by inverting the exact change (never by restoring a whole file), and watch it pass.
  Report that you did. If you did not, the wording is "green, never seen red".
- **Or hand it to an adversary.** An independent reviewer that is given the code and not your
  conclusion, and is told to break it. Report who reviewed and what they tried.
- **Count what ran.** When you say a suite passes, say how many checks ran. A skip is reported
  as a skip, never as a pass.
- **A precondition is an `assert`,** never an early `return`. A test that returns early is
  counted as a pass by the runner.

A result that was neither seen red nor adversarially reviewed may still be reported, but only
with that fact attached.

## 4. Delegation does not launder a claim

- What a subagent reports is DELEGATED until you re-run it. Relaying it unlabelled makes the
  false statement yours.
- Brief every subagent with this file's rule and require it to mark what it verified by
  command output versus what it inferred.
- Re-run the headline figures yourself before relaying them, and say which ones you re-ran
  and which you did not.
- A report that says "DONE" is a report. Open the changed files and run the checks.

## 5. What is the owner's and what is not

- Third-party code, installed dependencies, vendored libraries, generated output and
  duplicate checkouts are never counted as the owner's work, and never share a total with it.
- A figure for somebody else's code says so in the same sentence it appears in.
- **A true number placed where it will be misread is a failed report.** Worked example,
  2026-10-01: a line-count answer listed 16,970,929 lines of the spokes' `node_modules` one
  sentence after a table of owned code. Every figure was measured, and the owner read it as
  "17 million lines of my code". The measured answer was 247,762 lines of code in the hub.
  Lead with the one number that answers the question, and keep the rest visibly apart.

## 6. Failure is reported first

- A failing test, a skipped step, a partial run or an unfinished piece leads the report. It
  is never left for the reader to find.
- "Failed" is never softened into "mostly works", and the part that passed is never reported
  without the part that did not.
- When you find that something you reported earlier was wrong, say so at once, unprompted,
  naming what was wrong and what the correct statement is.

## 7. What this file cannot do

This file is an instruction. An agent reads it and follows it or does not. Nothing written
here can make a false report impossible, and an agent that claims otherwise has broken the
rule in the act of describing it. What makes a claim trustworthy is the evidence beside it,
which the owner or another agent can re-run.

Wherever a rule here can be turned into a gate that fails a build, build the gate, as
`npm run test:doc-inventory` did for the documentation convention. A convention is not a gate.
