// Interpret an operations.get response for the Long Audio LRO.
// done:true -> proceed to signing; otherwise loop back to the Wait node.

const op = $input.first().json;
if (op.error) {
  throw new Error(`Long Audio failed: ${JSON.stringify(op.error)}`);
}

const carry = $('Build LongAudio request').first().json;

if (op.done === true) {
  return [{ json: { ...carry, done: true } }];
}

return [{ json: { ...carry, done: false, operationName: op.name || carry.operationName } }];
