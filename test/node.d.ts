// The one Node.js call the tests make, typed here rather than with all of @types/node (which would type the page's own
// timers as Node's): a file the page fetches, read as its bytes.
declare module "node:fs" {
  export function readFileSync(path: URL): Uint8Array
}
