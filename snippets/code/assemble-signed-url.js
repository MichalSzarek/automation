// Turn the IAM signBlob response into the final V4 signed URL.
// signedBlob is base64 of the RSA-SHA256 signature; X-Goog-Signature must be lowercase hex.

const carry = $('Build signed url').first().json;
const resp = $input.first().json;
const signedBlobB64 = resp.signedBlob;

if (!signedBlobB64) {
  throw new Error(`signBlob returned no signedBlob: ${JSON.stringify(resp).slice(0, 300)}`);
}

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const clean = String(signedBlobB64).replace(/=+$/, '');
let bits = 0, val = 0, hex = '';
for (const ch of clean) {
  val = (val << 6) | chars.indexOf(ch);
  bits += 6;
  if (bits >= 8) {
    bits -= 8;
    hex += ('0' + (((val >> bits) & 0xff).toString(16))).slice(-2);
  }
}

const signedUrl = `${carry.baseUrl}&X-Goog-Signature=${hex}`;

return [{
  json: {
    signedUrl,
    objectName: carry.objectName,
    gcsUri: carry.gcsUri,
    show_notes: carry.show_notes,
    generatedAt: carry.generatedAt,
    ts: carry.ts
  }
}];
