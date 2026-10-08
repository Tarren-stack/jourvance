// The body parser's refusal of an oversized request, in the { success, error } shape every
// client here reads. Without it Express answered its default HTML error page, which in
// development names 'PayloadTooLargeError' and which no client could show. Mount it directly
// after express.json(): an error raised there skips to the next error handler, this one.
export const BODY_TOO_LARGE = 'That request is larger than this server accepts (1 MB), so nothing was saved. Make it smaller and try again.';

export function jsonBodyTooLarge(err, _req, res, next) {
  if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
    if (res.headersSent) return next(err);
    return res.status(413).json({ success: false, error: BODY_TOO_LARGE });
  }
  return next(err);
}
