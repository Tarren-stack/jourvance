# Ask Jourvance: panel copy

Final strings. Copy them verbatim. `{wait}` and `{reason}` are filled in at run time. No string here has an em dash, an exclamation mark or a spaced en dash. Written in the house voice of `AiJourneyBuilder.tsx` and `aiJourneyRoutes.mjs`: plain, short, and no promise the code does not keep.

| Key | Text |
|---|---|
| bubble.ariaLabel | Ask Jourvance |
| bubble.tooltip | Ask Jourvance a question |
| panel.title | Ask Jourvance |
| panel.intro | Ask about your numbers, your emails, or how to do something in Jourvance. |
| thread.empty | No questions yet. Ask one below. |
| suggest.numbers | How many leads did my journeys get in the last 30 days? |
| suggest.email | How many emails have I sent, opened and clicked? |
| suggest.howto | How do I publish a funnel? |
| input.label | Your question |
| input.placeholder | Type your question |
| input.tooLong | Questions can be up to 1,000 characters. |
| send.label | Send |
| busy.line | Thinking. This can take up to a minute. |
| signedOut.line | Sign in to ask about your business and your account. |
| signedOut.button | Sign In |
| unavailable.line | The assistant is not set up on this server, so it cannot answer yet. |
| limit.template | You have reached this hour’s limit for questions. Try again in {wait}. |
| failed.line | The assistant did not answer. Nothing was changed. Try again in a minute. |
| failed.retry | Retry |
| unreadable.line | The assistant answered with something Jourvance could not read. Try again. |
| feedback.group | Was this answer helpful? |
| feedback.helpful | Helpful |
| feedback.notHelpful | Not helpful |
| feedback.sharedOnce | Thanks. Your question, with anything specific to your business taken out, was shared to help improve Jourvance. |
| feedback.notSharedOnce | Thanks. Your rating is saved here. Nothing was shared. |
| feedback.alreadyShared | Rating updated. The copy of your question shared earlier stays shared. |
| notes.heading | What the assistant knows about your business |
| notes.help | Write facts the assistant should know, such as what you sell, who buys it and how you like to sound. Never write customer names or card details. |
| notes.tooLong | Notes can be up to 2,000 characters. |
| notes.save | Save notes |
| notes.saved | Notes saved. |
| notes.savedLocalOnly | Your notes are saved on this server, but the AI service did not take them. {reason} Try saving again later. |
| clear.label | Clear conversation |
| clear.confirm | Clear this conversation? Your questions and answers will be removed. |
| clear.confirmYes | Clear conversation |
| clear.confirmNo | Keep it |
| clear.done | Conversation cleared. |
| close.label | Close |

## Notes for the builder

- `feedback.sharedOnce` shows once, after the first Helpful whose answer from the server has `shared: true`. When `shared` is false, show `feedback.notSharedOnce` instead, once. Not helpful shows no line.
- `limit.template`: `{wait}` is the server's own wait text: `1 minute`, `12 minutes` or `1 hour`, the same words `limitMessage` builds. The apostrophe in the template is a curly one, as in the house sentence.
- `notes.saved` shows only when the server says the AI service took the notes. Otherwise show `notes.savedLocalOnly` with the server's reason in `{reason}`. If there is no reason, drop the `{reason}` slot and its space.
- `unavailable.line` is for the reason `ai-unavailable`. It has no Retry button, because retrying cannot help.
- Reading level: written to Grade 6 to 8. Every line is one to three short sentences.
- Screen reader: `busy.line` and the answer go in the polite log. `feedback.group` is the accessible name of the Helpful and Not helpful pair.
