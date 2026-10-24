const { execFile } = require('node:child_process');

const MAC_SCRIPT = [
  'try',
  '  set chosen to choose folder with prompt "Open a folder in Pixelbox"',
  '  POSIX path of chosen',
  'on error number -128',
  '  return ""',
  'end try',
].join('\n');

const WINDOWS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.Description = "Open a folder in Pixelbox"',
  'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
].join('; ');

function pickerCommand(platform) {
  if (platform === 'darwin') {
    return { file: 'osascript', args: ['-e', MAC_SCRIPT] };
  }
  if (platform === 'win32') {
    return { file: 'powershell', args: ['-NoProfile', '-Command', WINDOWS_SCRIPT] };
  }
  return { file: 'zenity', args: ['--file-selection', '--directory', '--title=Open a folder in Pixelbox'] };
}

// Returns { path } on pick, { canceled: true } when the user dismissed the
// dialog, and { unavailable: true } when the platform has no picker binary —
// the renderer then falls back to typing a path by hand.
function chooseFolder({ platform = process.platform } = {}) {
  const { file, args } = pickerCommand(platform);
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 5 * 60 * 1000 }, (error, stdout = '') => {
      const picked = String(stdout).trim();
      if (picked) {
        resolve({ path: picked.replace(/\/+$/, '') || picked });
        return;
      }
      if (error && (error.code === 'ENOENT' || error.code === 127)) {
        resolve({ unavailable: true, reason: `No folder picker available (${file}).` });
        return;
      }
      resolve({ canceled: true });
    });
  });
}

module.exports = {
  chooseFolder,
  pickerCommand,
};
