# Companion installation and updates

A Git checkout is sufficient; you do not need a RAR package.
A checkout means the repository folder created by `git clone`, containing its
`.git` metadata and configured remote branch. A folder copied/extracted with only
`check.js`, `package.json`, and `setup.sh` is not necessarily a Git checkout.
Keep the checkout in Termux's home directory (not Android shared storage).

For an older three-file release inside a clone, copying only this new `update.sh`
into `companion/` is enough to bootstrap missing helper files once they are on the
remote branch. If it replaces an older tracked updater, the copied bytes must
match the fetched upstream release; other local edits remain protected.

## First installation

From the checkout's `companion` directory:

```bash
bash setup.sh
```

Setup installs Node, Git, cron, Termux command-line API tools, and `flock`, then
configures scheduled checks and home-screen shortcuts. Install the separate
Termux:API, Termux:Boot and Termux:Widget Android apps from the same source as
Termux. Set Termux's battery usage to **Unrestricted** so Android does not stop
cron. Existing Gist configuration is kept when you rerun setup without new
credentials. For an existing installation, rerun setup once to route the existing
price-check cron job through the shared check/update lock. This does not schedule
updates; it only retains scheduled price checks. Keep your intended check interval
when rerunning setup, for example `bash setup.sh --interval 30`.

## Update now

```bash
bash update.sh
```

Or tap **pw-update** from Termux:Widget. This command **only updates**; it never
runs a price check. Keep your separate check command/widget for price checking.
The script updates the branch's
configured Git upstream, fast-forward only. It never guesses a different branch,
force-resets local edits, or performs a merge of divergent histories.

The new code must first be committed and pushed to that upstream. A script on
your phone cannot download changes that only exist on your computer.

The update stages the fetched companion and installs its exact locked dependencies
before moving the checkout. Package installation hooks are disabled. Invalid
scripts, failed dependency installation, local tracked edits, detached checkouts,
or a divergent branch stop the update. Phone-only `config.json`, `pricewatch.json`,
`state.json`, and logs are neither read nor modified by the updater. An upstream
that starts tracking those files is rejected.

The updater and `run-check.sh` share a lock, preventing cron/widget price checks
from running while dependencies are replaced. Existing checks are not killed:
an overlapping update/check reports **busy** (exit 75), and the next scheduled
run can try again. Use `bash run-check.sh` for manual checks too. Running
`node check.js` directly bypasses the lock.

If Git refuses the final fast-forward, old dependencies are restored. If
shortcut installation fails *after* Git has advanced, the updater reports
failure honestly; rerun `bash install-widgets.sh`. This is not a cross-filesystem
crash-atomic update. Configuration and history are kept independently of code.

Updates are **manual only**: one tap on the widget or one command. No update
schedule is created. Existing price-check scheduling is left alone.

## Logs and errors

```bash
tail -n 50 update.log
bash run-check.sh
```

- **Already up to date:** no new upstream revision.
- **Local edits / divergent branch:** resolve them deliberately; the updater
  will not discard anything.
- **Missing upstream:** set the intended tracking branch before updating.
- **Missing flock:** run `pkg install util-linux` or rerun setup.
- **Dependencies failed:** current code remains installed; retry after checking
  network access, disk space and Node version.
- **Upstream lacks standalone updater release:** the required files have not
  reached the phone's tracking branch yet.

If you transfer an archive instead, `setup.sh` can install/check the extracted
folder, but `update.sh` requires the folder to belong to a Git checkout. No public
release endpoint or credentials are embedded in these scripts.
