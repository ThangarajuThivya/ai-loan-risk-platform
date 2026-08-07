import api from "../api/axios";

/**
 * F3 — fetch a file endpoint as a blob and save it, rather than navigate to
 * it (these are authenticated GETs, not public URLs a plain <a href> could
 * hit). A temporary, invisible <a download> is the standard way to trigger
 * a real save-to-disk from a blob, as opposed to LoanDocumentPanel's
 * window.open preview — a decision letter/statement is meant to be kept.
 */
export default async function downloadFile(url, filename) {
  const res = await api.get(url, { responseType: "blob" });
  const blobUrl = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
}
