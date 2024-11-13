# Release signer

A github action to download, sign, and upload the signatures of release assets for a github release.

## Usage

This is intended to be used in a github action workflow, with an example given below.

```yaml
name: sign release assets

on:
    release:
        types: [released]

jobs:
    sign-assets:
        runs-on: ubuntu-latest
        steps:
            - name: Install gpg
              run: |
                sudo apt-get update
                sudo apt-get install gnupg

            - name: Add key
              run: |
                # Decode the key into a gpg file from its stored format
                gpg --import key-file.gpg

            - name: Run signer action
              uses: #This action
              with:
                github_token: ${{ secrets.GITHUB_TOKEN }}
                organization: ${{ github.repository_owner }}
                repository: ${{ github.repository }}
                release_tag: ${{ github.event.release.tag_name }}
                key_id: ${{ secrets.SIGNING_KEY_ID }}
                key_passphrase: ${{ secrets.SIGNING_KEY_PASSPHRASE }}

```


