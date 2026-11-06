import { createC2pa, Reader, Context } from "@contentauth/c2pa-web";
import wasmSrc from "@contentauth/c2pa-web/resources/c2pa.wasm?url";

// This is inspection only. Signing requires a protected signing identity.
const TRUST_LIST = "https://raw.githubusercontent.com/c2pa-org/conformance-public/refs/heads/main/trust-list/C2PA-TRUST-LIST.pem";
let sdkPromise;

function getSdk() {
  sdkPromise ||= createC2pa({ wasmSrc });
  return sdkPromise;
}

export async function inspectCredentials(file) {
  const format = ["image/jpeg", "image/png"].includes(file?.type) ? file.type :
    /\.jpe?g$/i.test(file?.name || "") ? "image/jpeg" :
    /\.png$/i.test(file?.name || "") ? "image/png" : "";
  if (!file || !["image/jpeg", "image/png"].includes(format)) {
    return { status: "unsupported", label: "JPG/PNG check available", detail: "This edition checks image credentials in JPG and PNG files." };
  }

  const c2pa = await getSdk();
  const context = new Context({
    verify: { verifyTrust: true },
    trust: { trustAnchors: TRUST_LIST },
  });
  const reader = await Reader.fromBlob(c2pa, format, file, context);
  if (!reader) {
    return { status: "none", label: "No embedded credentials found", detail: "This does not prove who made the image or where it traveled." };
  }

  try {
    const store = await reader.manifestStore();
    const active = store?.manifests?.[store.active_manifest] || {};
    const state = String(store?.validation_state || "").toLowerCase();
    const title = active.title || "";
    const summary = title ? `Active manifest: ${title}. ` : "";
    if (state === "trusted") {
      return { status: "trusted", label: "Credential trusted", detail: `${summary}Signature and trust chain passed this browser check. This does not prove every claim is true.` };
    }
    if (state === "valid") {
      return { status: "valid", label: "Credential valid · signer untrusted", detail: `${summary}Integrity passed, but the signer is not on the configured C2PA trust list.` };
    }
    if (state === "invalid") {
      return { status: "invalid", label: "Credential did not validate", detail: `${summary}The credential needs review. Open Adobe Inspect for more detail.` };
    }
    return { status: "present", label: "Credentials found · review needed", detail: `${summary}This SDK did not return a clear validation state.` };
  } finally {
    await reader.free();
  }
}
