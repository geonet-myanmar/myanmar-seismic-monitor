# Deployment Guide

## Goal

Publish the dashboard to GitHub Pages from the repository root using GitHub Actions.

## Included Deployment Configuration

The project already contains:

- `.github/workflows/deploy-pages.yml`
- `.nojekyll`

The workflow uploads the repository root as a Pages artifact and deploys it automatically.

## One-Time GitHub Repository Setup

1. Push this project to a GitHub repository.
2. Open the repository on GitHub.
3. Go to `Settings` -> `Pages`.
4. Under `Build and deployment`, set `Source` to `GitHub Actions`.
5. Ensure the default deployment branch is `main`, or update the workflow if you use another branch.

## Deploying

### Automatic Deploy

Every push to `main` triggers the workflow:

```yaml
on:
  push:
    branches:
      - main
```

### Manual Deploy

The workflow also supports manual execution from the GitHub Actions tab through `workflow_dispatch`.

## Deployment Workflow Summary

1. Checkout the repository
2. Configure GitHub Pages
3. Upload the repository root as the Pages artifact
4. Deploy the artifact to the Pages environment

## Expected Published URL

GitHub Pages usually publishes the site at:

```text
https://<github-username>.github.io/<repository-name>/
```

If you publish from a user or organization site repository named `<github-username>.github.io`, the URL is usually:

```text
https://<github-username>.github.io/
```

## Important Notes

- This project does not require a Node.js build step.
- All asset references are relative, which is suitable for GitHub Pages artifact deployment.
- The app still depends on live network access in the browser for:
  - the USGS earthquake API
  - the remote tectonic lineament GeoJSON
  - Leaflet, React, and ReactDOM CDN assets

## Troubleshooting

### The workflow runs but the site is blank

Check:

- `index.html` exists at the repository root
- the Pages source is set to `GitHub Actions`
- external CDN scripts are not blocked by the browser or network policy

### The tectonic overlay does not appear

Check:

- the tectonic GeoJSON URL in `app.js`
- browser console for CORS or fetch errors
- whether the toggle for tectonic lineaments is enabled

### Earthquakes do not load

Check:

- USGS API availability
- browser developer console for request failures
- whether the browser environment has internet access

## Redeployment After Changes

1. Commit the changes.
2. Push to `main`.
3. Wait for the `Deploy GitHub Pages` workflow to complete.
4. Refresh the published site.

