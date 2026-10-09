// Builds Mindapp desktop apps: macOS (Apple Silicon + Intel), Windows and Linux.
//   npm run build                 → all targets into desktop/dist/
//   node build.mjs darwin-arm64   → just one target
import { packager } from '@electron/packager';
import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const web = path.join(here, 'web');

// 1) copy the web app into the desktop bundle
rmSync(web, { recursive: true, force: true });
mkdirSync(web);
for (const f of ['index.html', 'manifest.webmanifest', 'css', 'js', 'icons']) cpSync(path.join(root, f), path.join(web, f), { recursive: true });
if (process.argv.includes('--copy-only')) process.exit(0);

const COMMON = `
YOUR NOTES
- Notes are saved on this computer only (private, works offline).
- To move notes between devices: Sync → Email a backup, then on the other
  device Sync → Open a backup… → Merge. Works with the iPhone/iPad app too.

VOICE TO TEXT
`;
const GUIDE = {
  darwin: `MINDAPP FOR MAC — HOW TO INSTALL

1. Double-click the zip (if it isn't unzipped already) to get "Mindapp.app".
2. Drag Mindapp.app into your Applications folder.
3. First time only — macOS checks apps that aren't from the App Store:
   - Double-click Mindapp. If macOS says it "can't be opened" or "can't verify
     the developer", click Done/OK.
   - Open System Settings → Privacy & Security, scroll down and click
     "Open Anyway" next to Mindapp, then confirm with your password.
   (On older macOS you can instead right-click Mindapp → Open → Open.)
4. From then on it opens normally. Right-click its Dock icon → Options →
   Keep in Dock.

If macOS says the app "is damaged": open Terminal and run
   xattr -cr /Applications/Mindapp.app
then open it again. (This only removes the download "quarantine" flag.)
${COMMON}- Press Fn (🌐) twice, or Edit → Start Dictation, while typing in any box.
`,
  win32: `MINDAPP FOR WINDOWS — HOW TO INSTALL

1. Right-click the zip → Extract All… and choose a folder (e.g. Documents).
2. Open the extracted folder and double-click Mindapp.exe.
3. First time only: if Windows shows "Windows protected your PC", click
   "More info" → "Run anyway". (The app isn't from the Microsoft Store.)
4. Tip: right-click Mindapp.exe → Pin to Start / Pin to taskbar.
${COMMON}- Press Windows key + H while typing in any box.
`,
  linux: `MINDAPP FOR LINUX — HOW TO INSTALL

1. Extract the zip to a folder.
2. Run ./mindapp from that folder (you may need: chmod +x mindapp).
${COMMON}- Use your desktop's dictation tool, if it has one.
`,
};

const all = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'];
const targets = process.argv.slice(2).filter(a => all.includes(a));
const out = path.join(here, 'dist');
mkdirSync(out, { recursive: true });

for (const t of targets.length ? targets : all) {
  const [platform, arch] = t.split('-');
  const [dir] = await packager({
    dir: here,
    out: path.join(here, 'out'),
    overwrite: true,
    platform, arch,
    name: 'Mindapp',
    executableName: platform === 'linux' ? 'mindapp' : 'Mindapp',
    appBundleId: 'app.mindapp.desktop',
    appCategoryType: 'public.app-category.productivity',
    appCopyright: 'Mindapp',
    icon: path.join(here, 'build', 'icon'),
    darwinDarkModeSupport: true,
    asar: true,
    prune: true,
    ignore: [/^\/(out|dist|build|node_modules\/\.cache)(\/|$)/, /^\/build\.mjs$/],
    extendInfo: { NSMicrophoneUsageDescription: 'Mindapp uses the microphone only when you tap the mic to dictate.' },
    win32metadata: { CompanyName: 'Mindapp', FileDescription: 'Mindapp', ProductName: 'Mindapp' },
  });
  // ad-hoc sign Mac builds when rcodesign is available (Apple Silicon refuses unsigned apps)
  if (platform === 'darwin' && existsSync(process.env.RCODESIGN || '')) {
    execFileSync(process.env.RCODESIGN, ['sign', path.join(dir, 'Mindapp.app')], { stdio: 'inherit' });
  }
  const name = { 'darwin-arm64': 'Mindapp-Mac-AppleSilicon', 'darwin-x64': 'Mindapp-Mac-Intel', 'win32-x64': 'Mindapp-Windows', 'linux-x64': 'Mindapp-Linux' }[t];
  writeFileSync(path.join(dir, platform === 'win32' ? 'HOW TO INSTALL.txt' : 'HOW TO INSTALL.txt'), GUIDE[platform].replace(/\n/g, platform === 'win32' ? '\r\n' : '\n'));
  const zip = path.join(out, name + '.zip');
  rmSync(zip, { force: true });
  // -y keeps the symlinks inside macOS frameworks intact
  execFileSync('zip', ['-qry', zip, '.'], { cwd: dir });
  console.log('built', zip);
}
