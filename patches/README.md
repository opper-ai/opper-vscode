# Login SDK transport patch

The extension pins the published `@opperai/login` 0.4.1 release.
`npm ci` applies the checked-in patch with patch-package, failing on drift.
The patch adds AbortSignal cancellation, total/per-request deadlines, rejects
redirects, and reads the server error envelope on device start. These changes
preserve the published device login and renewal contract. Both module formats
and declarations are patched. Remove the patch when an upstream version
includes these fixes. No unpublished tarball is needed.
