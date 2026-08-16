# Extraction evaluation

Measures whether Luma's AI extraction is actually good enough, against a
hand-annotated dataset of 120 synthetic emails.

## Running it

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run eval
```

Options:

```bash
EVAL_LIMIT=20 npm run eval          # smoke test on the first 20 emails
LUMA_MODEL=claude-sonnet-5 npm run eval
LUMA_EFFORT=medium npm run eval
EVAL_OUT=results/run.json npm run eval
npm run eval:dry                    # exercises the harness without the model
```

Results print to stdout and a full JSON artifact is written to
`evals/results/`. **`eval:dry` produces meaningless numbers** — it exists only
to prove the plumbing works without spending tokens, and says so in the output.

## What it measures

It drives the **production code path**: same prefilter, same prompt, same
model, same batching, same verification, dedupe, and prioritization. Nothing is
reimplemented, so what it measures is the product, not a sketch of it.

| Metric | Definition |
|---|---|
| precision | TP / (TP + FP) — of the loops surfaced, how many were real |
| recall | TP / (TP + FN) — of the real obligations, how many were found |
| false-positive rate | 1 − precision |
| noise-email FP rate | share of emails whose correct answer was "nothing" that produced a loop |
| category accuracy | of matched loops, share with the right category |
| deadline accuracy | exact date match; a ±2 day tolerance is reported separately for *inferred* dates only |
| fabricated deadlines | expected no date, system produced one |
| evidence accuracy | share of stored quotes that are genuinely verbatim in a cited email |
| duplicate rate | near-duplicate predicted loops (using the app's own similarity function) |
| prefilter recall ceiling | the best recall achievable given what preprocessing discarded |

Every rate is printed with its numerator and denominator. A zero denominator
reports `n/a`, never a fake 0% or 100%.

## Failure attribution

The harness records what the model proposed **before** the deterministic guards
see it (`RecordingExtractor`). Comparing raw candidates to persisted loops
separates failures that look identical in the final output:

| Layer | Question it answers |
|---|---|
| prefilter | Did the email even reach the model? |
| raw candidates | Did the model find it at all? |
| verification | Did the model find it and a guard throw it away? |
| dedupe | Did two correct loops collapse into one? |

## The dataset

120 emails across 15 buckets, in `evals/dataset/`:

| Group | Buckets | Emails | Expected loops |
|---|---|---|---|
| Obligations | deadline, follow_up, commitment, appointment, form | 42 | 39 |
| Transactions | renewal, payment, return | 22 | 18 |
| Noise | newsletter, marketing, automated, personal | 33 | 4 |
| Hard | ambiguous, multi_obligation, hallucination_bait | 23 | 18 |

51 of the 120 emails expect **nothing**. That is deliberate: a dataset of mostly
positives cannot measure false positives, and false positives are what make this
product untrustworthy.

Every email carries a `rationale` explaining why its expected answer is what it
is. Read it before disputing a failure — sometimes the annotation is wrong, and
`tests/evals.test.ts` checks the annotations for internal consistency (dates
match their basis, evidence hints genuinely appear in the body, negative buckets
really are empty).

### The bait cases

`hallucination_bait` is the most important bucket. Nine emails full of dates,
urgency, and commitments where the correct answer is nothing:

- commitments made by the **sender**, not the user (`hb-05`)
- a request already resolved later in the thread (`hb-03`)
- general rules stated as facts ("returns must be filed by April 15") (`hb-02`)
- dates with an explicit "no action required" (`hb-04`, `hb-07`)

It is easy to build an extractor that finds every real deadline. The hard part
is one that does not invent them.

## Matching

Predicted loops are aligned to expected ones by keyword overlap on
title + summary, requiring the prediction to cite the right email, assigned
greedily and strictly 1:1. Category is deliberately **excluded** from matching
so category accuracy can be measured independently.

One prediction can never satisfy two expected loops — otherwise a single vague
loop would silently paper over a multi-obligation email.

## Cost

Computed from the token counts the API actually reported (recorded on `AiRun`),
multiplied by published list prices. Excludes any prompt-cache discount, so it
is an upper bound.
