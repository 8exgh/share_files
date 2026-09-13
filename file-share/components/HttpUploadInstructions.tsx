export default function HttpUploadInstructions() {
  const expiringExample = `curl -u 'YOUR_USERNAME:YOUR_PASSWORD' \\
  -F 'file=@./example.pdf' \\
  https://YOUR_HOST/api/upload`;
  const permanentExample = `curl -u 'YOUR_USERNAME:YOUR_PASSWORD' \\
  -F 'file=@./example.pdf' \\
  'https://YOUR_HOST/api/upload?autoDelete=false'`;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm" aria-labelledby="http-upload-heading">
      <h2 id="http-upload-heading" className="text-xl font-semibold text-gray-900">Upload with an HTTP command</h2>
      <p className="mt-2 text-sm text-gray-600">
        Use HTTP Basic Auth with the same username and password you use to sign in here. The multipart field must be named <code className="rounded bg-gray-100 px-1 py-0.5">file</code>.
      </p>

      <h3 className="mt-5 text-sm font-semibold text-gray-900">Auto-delete after one hour (default)</h3>
      <pre className="mt-2 overflow-x-auto rounded-md bg-gray-900 p-4 text-sm text-gray-100"><code>{expiringExample}</code></pre>

      <h3 className="mt-5 text-sm font-semibold text-gray-900">Keep the file</h3>
      <pre className="mt-2 overflow-x-auto rounded-md bg-gray-900 p-4 text-sm text-gray-100"><code>{permanentExample}</code></pre>

      <p className="mt-3 text-xs text-gray-500">
        The response is JSON. On success, use <code className="rounded bg-gray-100 px-1 py-0.5">data.downloadUrl</code> as the share link. You can also send <code className="rounded bg-gray-100 px-1 py-0.5">-F 'autoDelete=false'</code> instead of using the query parameter.
      </p>
    </section>
  );
}
