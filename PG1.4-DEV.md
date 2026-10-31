# PG1.4 development

Baseline: PG1.3 1.3.1, commit `636f6ed46252ca5d2c444a818accc1312369ce8c` on `pg13-clipboard-20261030`. The working tree was clean before branching; there were no uncommitted user changes to protect.

Development branch: `pg14-copy-shortcuts-20261031`. The installed PG1.3 and its settings are not modified by this source-only work. Existing internal identity remains unchanged to preserve settings and authentication on a future upgrade.

- Ctrl+C immediately copies selected nodes with their links, styles and layout.
- Ctrl+C followed by Ctrl+C within 350 ms copies selected node text. Ctrl may stay held between presses.
- Both commands are editable in Settings > Shortcuts > Basic, as Copy Nodes and Copy Text. Existing custom key bindings remain intact; only the new command receives its default when missing.
- Keyboard auto-repeat does not count as a second press. Input fields keep native text copying, and focus/project changes end the sequence.
- Clipboard writes are ordered across projects, and immediate paste waits for a pending copy.
- No installer is generated or installed during this development change.

All PG1.3 features remain on this branch. Build and installation require a later packaging request.

Validation: the pre-change copy/shortcut baseline passed 29 tests. After the change, 87 related tests passed across copy/paste, keyboard sequences, drawing and geometry. Type checking and lint passed. Tests cover physical double presses versus auto-repeat, text inputs and shortcut recording, focus/project changes, configurable sequences, slow attachment preparation, overlapping clipboard writes, and immediate cross-project paste. Local checks used Node 24.19.0; the project requests Node 26. No PG1.4 native build or desktop acceptance test has been run yet.

The generated zh_TW locale was refreshed from zh_CN using the existing sync-locales command; it also includes translations already present in PG1.3's source locale. The Windows packaging configuration now uses the configured product name to find the installed executable and labels future artifacts PG1.4. Automatic packaging remains disabled for this development branch.
