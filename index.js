const fs = require('node:fs')
const { execSync } = require('node:child_process')
const core = require('@actions/core')

// Given a repo, release, API key, and gpg key
const github_token = core.getInput('github_token')
const full_repository = core.getInput('full_repository')
const release_tag = core.getInput('release_tag')
const key_id = core.getInput('key_id')
const key_passphrase = core.getInput('key_passphrase')

async function main() {
    // GPG installed, key present
    let gpg_version = run_command('gpg --version')
    if (gpg_version.includes('not found')) {
        fail_and_exit('GPG not found')
    }
    let key_present = run_command(`gpg --list-keys ${key_id}`)
    if  (key_present.includes('not found')) {
        fail_and_exit('GPG key not found')
    }

    let [organization, repository] = full_repository.split('/')

    // Get release id
    let release = await get_release()
    console.log(`Got release: ${release}`)
    let release_id = release.id

    // Get assets from github
    let release_assets = release.assets.map(asset => {
        return {
            name: asset.name,
            download_url: asset.browser_download_url
        }
    })
    // Append the default release assets
    let version_regex = /\d+\.\d+\.\d+/.exec(release_tag)
    if (version_regex === null) {
        core.setFailed(`Tag did not match expected version format: ${release_tag}`)
    }
    let semver_version = version_regex[0]
    release_assets.push({
        name: `${repository}-${semver_version}.tar.gz`,
        download_url: `https://github.com/${full_repository}/archive/refs/tags/${release_tag}.tar.gz`
    })
    release_assets.push({
        name: `${repository}-${semver_version}.zip`,
        download_url: `https://github.com/${full_repository}/archive/refs/tags/${release_tag}.zip`
    })

    // Download the assets
    let asset_downloads = release_assets.map(asset => {
        return download_asset(asset.name, asset.download_url)
    })

    let completed_downloads = await Promise.all(asset_downloads)
    // Some assertion here to check all the downloads were successful

    release_assets.forEach(asset => {
        run_command(`gpg --batch --pinentry-mode loopback --armor --output ${asset.name}.asc --local-user ${key_id} --passphrase ${key_passphrase} --detach-sig ${asset.name}`)
        run_command(`gpg --batch --verify ${asset.name}.asc ${asset.name}`)
    })

    // Upload the signed assets
    let upload_promises = release_assets.map(asset => {
        return upload_asset(`${asset.name}.asc`, release_id)
    })
    let completed_uploads = await Promise.all(upload_promises)
    // Some way to confirm the uploads worked
}


function run_command(command) {
    try {
        return execSync(command, { timeout: 10000})
    } catch (error) {
        fail_and_exit(error.message)
    }
}

async function get_release() {
    const url = `https://api.github.com/repos/${full_repository}/releases/tags/${release_tag}`
    console.log(`Fetching release from ${url}`)
    return await fetch(url, {
        headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${github_token}`,
            "X-GitHub-Api-Version": "2022-11-28"
        }
    })
        .then(response => {
            if (response.status !== 200) {
                throw new Error(`Failed to fetch release: ${response.status} : ${response.message}`)
            }
            console.log("Release fetched")
            return response.json()
        })
        .catch(error => {
            fail_and_exit(error.message)
        })
}

async function get_asset_list(release_id) {
    const url = `https://api.github.com/repos/${full_repository}/releases/${release_id}/assets`
    return await fetch(url, {
        headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${github_token}`,
            "X-GitHub-Api-Version": "2022-11-28"
        }
    })
        .then(response => {
            if (response.status !== 200) {
                throw new Error(`Failed to fetch release assets: ${response.status} : ${response.message}`)
            }
            return response.json()
        })
        .then(data => {
            return data.map(asset => {
                return {
                    name: asset.name,
                    download_url: asset.browser_download_url
                }
            })
        })
        .catch(error => {
            fail_and_exit(error.message)
        })
}

async function download_asset(name, download_url) {
    return await fetch(download_url, {
        headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${github_token}`,
            "X-GitHub-Api-Version": "2022-11-28"
        }
    })
        .then(response => {
            if (response.status !== 200) {
                throw new Error(`Failed to download asset ${name}: ${response.status}: ${response.message}`)
            }
            return response.blob()
        })
        .then(blob => blob.arrayBuffer())
        .then(array_buffer => {
            let buffer = Buffer.from(array_buffer)
            return fs.writeFile(name, buffer, (err) => {
                if (err) throw err
            });
        })
        .catch(error => {
            fail_and_exit(error.message)
        })
}

async function upload_asset(name, release_id) {
    const url = `https://uploads.github.com/repos/${full_repository}/releases/${release_id}/assets?name=${name}`;
    return await fetch(url, {
        method: 'POST',
        headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${github_token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/octet-stream"
        },
        body: fs.readFileSync(name)
    })
        .then(response => {
            if (response.status !== 201) {
                throw new Error(`Failed to upload file ${name}: ${response.status}: ${response.message}`)
            }
            return response.message
        })
        .catch(error => {
            fail_and_exit(error.message)
        })
}

function fail_and_exit(message) {
    core.setFailed(message)
    process.exit(1)
}

main()
