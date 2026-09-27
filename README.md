# GitHub File Timeline

A UserScript that adds a timeline slider to GitHub code files, letting you browse previous versions directly in the code view.

## Features

- Browse up to 100 previous commits for a file
- View historical versions directly in the GitHub code view
- Syntax highlighting with Prism.js
- Line numbers for historical versions
- Select and copy historical code
- Return to GitHub's native code view at the newest commit
- Works with public GitHub repositories
- No GitHub authentication or personal access token required

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Create a new UserScript.
3. Copy the contents of `github-file-timeline.user.js` into the editor.
4. Save the UserScript.
5. Open a GitHub file page, for example:
   `https://github.com/owner/repository/blob/main/file.py`

The timeline slider will appear above the file when commit history is available.

## Usage

- Move the slider to the **left** to view older versions.
- Move the slider to the **right** to return to the newest version.
- The selected commit's date and message are displayed above the file.
- Historical versions can be selected and copied like normal code.

## Limitations

- Only public GitHub repositories are supported.
- Up to 100 commits are loaded for each file.
- File renames are not followed across history.
- Diff viewing is not included.
- Unsupported languages are displayed as plain text.
- The UserScript depends on GitHub's page structure and may require updates if GitHub changes its interface.

## How It Works

The UserScript:

1. Reads the current repository, file path, branch/ref, and commit information from GitHub's embedded page data.
2. Retrieves the file's commit history using the GitHub Commits API.
3. Uses GitHub's raw file endpoint to retrieve the selected historical version.
4. Renders historical versions in a custom code view.
5. Uses Prism.js for syntax highlighting.
6. Restores GitHub's native code view when the newest commit is selected.

## Supported Languages

Syntax highlighting is currently configured for:

- JavaScript
- TypeScript
- Python
- C
- C++
- Java
- Go
- JSON
- Shell
- Markdown
- CSS
- HTML

Other file types can still be displayed without syntax highlighting.