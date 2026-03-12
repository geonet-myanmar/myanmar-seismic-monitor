# Myanmar Earthquake Dashboard

Interactive web dashboard for exploring historical earthquakes within the national boundary of Myanmar. The application fetches earthquake records from the USGS earthquake catalog, spatially filters them against the Myanmar national boundary GeoJSON, and visualizes the results alongside Myanmar tectonic lineaments.

## Features

- Real-time data retrieval from the USGS FDSN earthquake API
- Historical catalog loading with automatic periodic refresh
- Spatial filtering using Myanmar's national boundary from `mm_national_boun.json`
- Interactive Leaflet map with:
  - Myanmar national boundary
  - Myanmar tectonic lineaments
  - Earthquake point markers sized by magnitude and colored by depth
- Summary metrics for catalog size, strongest event, latest event, and average depth
- Filter controls for place name, minimum magnitude, and year range
- Charts for earthquake counts through time and magnitude/depth distributions
- Recent-event table with links back to the USGS event page
- Static-site deployment support for GitHub Pages

## Project Structure

```text
.
|-- .github/
|   `-- workflows/
|       `-- deploy-pages.yml
|-- .nojekyll
|-- app.js
|-- index.html
|-- mm_national_boun.json
|-- README.md
`-- styles.css
```

## Technology Stack

- React 18 via CDN
- Leaflet for the interactive map
- Plain JavaScript and CSS
- GitHub Pages for hosting

The application is intentionally implemented as a static site so it can be served directly by GitHub Pages without a Node.js build step.

## Data Sources

### Earthquake Catalog

- Source: USGS Earthquake Hazards Program
- Endpoint: `https://earthquake.usgs.gov/fdsnws/event/1/query`
- Format: GeoJSON
- Query strategy:
  - load the historical catalog in paginated batches
  - constrain requests using Myanmar's geographic bounding box
  - retain only features that fall within the Myanmar national boundary polygon
  - poll periodically for newly updated records

### Myanmar National Boundary

- Local file: `mm_national_boun.json`
- Geometry type: `MultiPolygon`
- Purpose: definitive spatial mask for whether an earthquake should be retained

### Myanmar Tectonic Lineaments

- Remote file:
  `https://raw.githubusercontent.com/drtinkooo/myanmar-earthquake-archive/main/Myanmar_Tectonic_Map_2011.geojson`
- Purpose: contextual overlay to interpret earthquake distributions relative to tectonic structures

## How It Works

1. The app loads `mm_national_boun.json`.
2. It computes the Myanmar bounding box from that geometry.
3. It requests earthquake records from USGS using the bounding box to reduce the search space.
4. Each returned event is checked against the Myanmar boundary polygon.
5. Only earthquakes inside Myanmar are retained and rendered.
6. The tectonic lineament GeoJSON is fetched and rendered as a background overlay.
7. The dashboard polls USGS every 5 minutes for updates.

## Local Development

Because the app is a static site, any simple local web server is sufficient.

### Option 1: Python

```powershell
cd C:\Users\Tin Ko Oo\Desktop\demo
python -m http.server 4173
```

Open `http://127.0.0.1:4173`.

### Option 2: VS Code Live Server

Open the folder and serve `index.html` with Live Server.

## GitHub Pages Deployment

The repository already includes a GitHub Actions workflow for Pages deployment:

- Workflow file: `.github/workflows/deploy-pages.yml`
- Trigger: push to `main` or manual workflow dispatch
- Hosting mode: GitHub Actions artifact deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full publishing procedure.

## Configuration Notes

- Asset paths are relative, so the site is compatible with GitHub Pages artifact deployment.
- `.nojekyll` is included so GitHub Pages serves the site as plain static content.
- No package install is required for deployment.

## Map Interpretation

- Earthquake marker size increases with magnitude.
- Earthquake marker color indicates depth:
  - shallow: orange
  - intermediate: amber
  - deep: teal
- Tectonic lineaments are shown as dark gray linework.
- The Myanmar national boundary is shown as a polygon overlay.

## Limitations

- Initial historical loading time depends on USGS response time and catalog size.
- The application depends on live remote services from USGS and GitHub raw content.
- Tectonic lineaments are contextual overlays only; they are not used in the filtering logic.
- This is a client-side application, so very large datasets may affect browser performance.

## Maintenance

- Replace `mm_national_boun.json` if a newer authoritative national boundary is required.
- Update the tectonic overlay URL in `app.js` if the source location changes.
- Adjust `POLL_INTERVAL_MS` in `app.js` to change automatic refresh cadence.
- Adjust `PAGE_SIZE` in `app.js` if the API or performance profile changes.

## Documentation

- [Deployment Guide](docs/DEPLOYMENT.md)
- [Architecture Notes](docs/ARCHITECTURE.md)

