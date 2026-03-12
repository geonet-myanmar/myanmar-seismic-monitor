const { useEffect, useRef, useState } = React;

const HISTORY_START = '1900-01-01';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 20000;
const USGS_QUERY_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const TECTONIC_LAYER_URL =
  'https://raw.githubusercontent.com/drtinkooo/myanmar-earthquake-archive/main/Myanmar_Tectonic_Map_2011.geojson';
const currentYear = new Date().getUTCFullYear();
const chartPalette = ['#ff7b54', '#f4b860', '#4fb2b8'];

function computeBoundaryBox(geometry) {
  const bounds = {
    minLatitude: Infinity,
    maxLatitude: -Infinity,
    minLongitude: Infinity,
    maxLongitude: -Infinity
  };

  function walk(node) {
    if (typeof node[0] === 'number') {
      const [longitude, latitude] = node;
      bounds.minLatitude = Math.min(bounds.minLatitude, latitude);
      bounds.maxLatitude = Math.max(bounds.maxLatitude, latitude);
      bounds.minLongitude = Math.min(bounds.minLongitude, longitude);
      bounds.maxLongitude = Math.max(bounds.maxLongitude, longitude);
      return;
    }

    node.forEach(walk);
  }

  walk(geometry.coordinates);
  return bounds;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    const intersects =
      y1 > y !== y2 > y &&
      x < ((x2 - x1) * (y - y1)) / ((y2 - y1) || Number.EPSILON) + x1;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon[0])) {
    return false;
  }

  for (let index = 1; index < polygon.length; index += 1) {
    if (pointInRing(point, polygon[index])) {
      return false;
    }
  }

  return true;
}

function isPointInsideFeature(point, feature) {
  const geometry = feature?.geometry;

  if (!geometry) {
    return false;
  }

  if (geometry.type === 'Polygon') {
    return pointInPolygon(point, geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  }

  return false;
}

function buildQueryUrl(parameters) {
  const searchParams = new URLSearchParams({
    format: 'geojson',
    jsonerror: 'true',
    eventtype: 'earthquake',
    ...parameters
  });

  return `${USGS_QUERY_URL}?${searchParams.toString()}`;
}

async function fetchEarthquakeBatch(parameters, signal) {
  const response = await fetch(buildQueryUrl(parameters), { signal });

  if (!response.ok) {
    throw new Error(`USGS request failed with ${response.status}`);
  }

  const payload = await response.json();

  if (!Array.isArray(payload.features)) {
    throw new Error('USGS returned an unexpected response payload');
  }

  return payload.features;
}

function filterFeaturesWithinBoundary(features, boundaryFeature) {
  return features.filter((feature) => {
    const longitude = feature?.geometry?.coordinates?.[0];
    const latitude = feature?.geometry?.coordinates?.[1];

    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return false;
    }

    return isPointInsideFeature([longitude, latitude], boundaryFeature);
  });
}

function mergeEarthquakes(existing, incoming) {
  const byId = new Map(existing.map((feature) => [feature.id, feature]));
  incoming.forEach((feature) => byId.set(feature.id, feature));

  return Array.from(byId.values()).sort(
    (left, right) => (right?.properties?.time ?? 0) - (left?.properties?.time ?? 0)
  );
}

async function streamHistoricalEarthquakes({
  boundaryBox,
  boundaryFeature,
  signal,
  onBatch
}) {
  let offset = 1;
  let fetchedCount = 0;
  let acceptedCount = 0;
  let page = 0;
  const catalogEndTime = new Date().toISOString();

  while (true) {
    const features = await fetchEarthquakeBatch(
      {
        minlatitude: boundaryBox.minLatitude.toFixed(6),
        maxlatitude: boundaryBox.maxLatitude.toFixed(6),
        minlongitude: boundaryBox.minLongitude.toFixed(6),
        maxlongitude: boundaryBox.maxLongitude.toFixed(6),
        starttime: HISTORY_START,
        endtime: catalogEndTime,
        orderby: 'time-asc',
        limit: String(PAGE_SIZE),
        offset: String(offset)
      },
      signal
    );

    const accepted = filterFeaturesWithinBoundary(features, boundaryFeature);

    fetchedCount += features.length;
    acceptedCount += accepted.length;
    page += 1;

    onBatch({
      page,
      fetchedCount,
      acceptedCount,
      features: accepted
    });

    if (features.length < PAGE_SIZE) {
      return { page, fetchedCount, acceptedCount };
    }

    offset += PAGE_SIZE;
  }
}

async function fetchRealtimeUpdates({
  boundaryBox,
  boundaryFeature,
  updatedAfter,
  signal
}) {
  let offset = 1;
  const accepted = [];

  while (true) {
    const features = await fetchEarthquakeBatch(
      {
        minlatitude: boundaryBox.minLatitude.toFixed(6),
        maxlatitude: boundaryBox.maxLatitude.toFixed(6),
        minlongitude: boundaryBox.minLongitude.toFixed(6),
        maxlongitude: boundaryBox.maxLongitude.toFixed(6),
        updatedafter: updatedAfter,
        orderby: 'time-asc',
        limit: String(PAGE_SIZE),
        offset: String(offset)
      },
      signal
    );

    accepted.push(...filterFeaturesWithinBoundary(features, boundaryFeature));

    if (features.length < PAGE_SIZE) {
      return accepted;
    }

    offset += PAGE_SIZE;
  }
}

function formatUtcDate(value) {
  if (!value) {
    return 'n/a';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(new Date(value));
}

function formatMagnitude(value) {
  return Number.isFinite(value) ? value.toFixed(1) : 'n/a';
}

function formatDepth(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} km` : 'n/a';
}

function formatCoordinate(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}

function getEventYear(feature) {
  return new Date(feature?.properties?.time ?? 0).getUTCFullYear();
}

function buildYearlySeries(events) {
  const counts = new Map();
  events.forEach((feature) => {
    const year = getEventYear(feature);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([year, count]) => ({ year, count }));
}

function buildMagnitudeBands(events) {
  const bands = [
    { label: 'Below 3.0', count: 0 },
    { label: '3.0-4.9', count: 0 },
    { label: '5.0-5.9', count: 0 },
    { label: '6.0+', count: 0 }
  ];

  events.forEach((feature) => {
    const magnitude = feature?.properties?.mag ?? 0;

    if (magnitude < 3) {
      bands[0].count += 1;
    } else if (magnitude < 5) {
      bands[1].count += 1;
    } else if (magnitude < 6) {
      bands[2].count += 1;
    } else {
      bands[3].count += 1;
    }
  });

  return bands;
}

function buildDepthBands(events) {
  const bands = [
    { name: 'Shallow', value: 0, color: '#ff7b54' },
    { name: 'Intermediate', value: 0, color: '#f4b860' },
    { name: 'Deep', value: 0, color: '#4fb2b8' }
  ];

  events.forEach((feature) => {
    const depth = feature?.geometry?.coordinates?.[2] ?? 0;

    if (depth <= 35) {
      bands[0].value += 1;
    } else if (depth <= 100) {
      bands[1].value += 1;
    } else {
      bands[2].value += 1;
    }
  });

  return bands;
}

function getAverageDepth(events) {
  if (events.length === 0) {
    return 0;
  }

  return (
    events.reduce(
      (sum, feature) => sum + (feature?.geometry?.coordinates?.[2] ?? 0),
      0
    ) / events.length
  );
}

function findStrongestEvent(events) {
  return events.reduce((strongest, current) => {
    if (!strongest) {
      return current;
    }

    return (current?.properties?.mag ?? 0) > (strongest?.properties?.mag ?? 0)
      ? current
      : strongest;
  }, null);
}

function getMarkerStyle(feature) {
  const depth = feature?.geometry?.coordinates?.[2] ?? 0;
  const magnitude = feature?.properties?.mag ?? 0;
  const fillColor = depth > 100 ? '#4fb2b8' : depth > 35 ? '#f4b860' : '#ff7b54';

  return {
    radius: Math.max(3, Math.min(18, 3 + magnitude * 1.8)),
    fillColor,
    color: '#f8efe2',
    weight: 1,
    opacity: 0.85,
    fillOpacity: 0.62
  };
}

function StatCard({ label, value, note }) {
  return (
    <article className="stat-card">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function countLineamentFeatures(collection) {
  return Array.isArray(collection?.features) ? collection.features.length : 0;
}

function TrendChart({ data }) {
  if (data.length === 0) {
    return <div className="empty-state">No events in the current filter.</div>;
  }

  const maxCount = Math.max(...data.map((item) => item.count), 1);
  const width = 760;
  const height = 220;
  const leftPadding = 28;
  const bottomPadding = 28;
  const usableWidth = width - leftPadding - 12;
  const usableHeight = height - bottomPadding - 10;

  const points = data.map((item, index) => {
    const x = leftPadding + (index / Math.max(data.length - 1, 1)) * usableWidth;
    const y = 10 + usableHeight - (item.count / maxCount) * usableHeight;
    return { x, y, year: item.year, count: item.count };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const areaPath = `${linePath} L ${leftPadding + usableWidth} ${height - bottomPadding} L ${leftPadding} ${height - bottomPadding} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="trend-svg" role="img" aria-label="Earthquake counts by year">
      <line x1={leftPadding} y1={height - bottomPadding} x2={width - 12} y2={height - bottomPadding} className="trend-axis" />
      <line x1={leftPadding} y1={10} x2={leftPadding} y2={height - bottomPadding} className="trend-axis" />
      <path d={areaPath} className="trend-area" />
      <path d={linePath} className="trend-line" />
      {points.map((point) => (
        <circle key={point.year} cx={point.x} cy={point.y} r="3.2" className="trend-dot">
          <title>{`${point.year}: ${point.count} earthquakes`}</title>
        </circle>
      ))}
    </svg>
  );
}

function MagnitudeChart({ data }) {
  const maxCount = Math.max(...data.map((item) => item.count), 1);

  return (
    <div className="magnitude-bars">
      {data.map((item, index) => (
        <article key={item.label} className="magnitude-bar-card">
          <div className="magnitude-bar-track">
            <div
              className="magnitude-bar-fill"
              style={{
                height: `${(item.count / maxCount) * 100}%`,
                background: chartPalette[index % chartPalette.length]
              }}
            />
          </div>
          <strong>{item.count.toLocaleString()}</strong>
          <span>{item.label}</span>
        </article>
      ))}
    </div>
  );
}

function DepthDistribution({ data }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="depth-layout">
      <div className="depth-stack" aria-label="Depth distribution">
        {data.map((item) => (
          <span
            key={item.name}
            className="depth-segment"
            style={{
              width: `${total === 0 ? 0 : (item.value / total) * 100}%`,
              background: item.color
            }}
            title={`${item.name}: ${item.value}`}
          />
        ))}
      </div>
      <div className="legend-list">
        {data.map((item) => (
          <div key={item.name} className="legend-item">
            <span className="legend-swatch" style={{ background: item.color }} />
            <strong>{item.name}</strong>
            <span>{item.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MyanmarMap({
  boundaryFeature,
  boundaryBox,
  tectonicCollection,
  showTectonics,
  events
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const eventLayerRef = useRef(null);
  const tectonicLayerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !boundaryFeature || mapRef.current) {
      return undefined;
    }

    const map = L.map(containerRef.current, {
      preferCanvas: true,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    L.geoJSON(boundaryFeature, {
      style: {
        color: '#ffe6bc',
        weight: 2,
        fillColor: '#1d4f5f',
        fillOpacity: 0.18
      }
    }).addTo(map);

    tectonicLayerRef.current = L.geoJSON(null, {
      style: {
        color: '#4a4a4a',
        weight: 1.8,
        opacity: 0.9
      },
      onEachFeature: (feature, layer) => {
        const properties = feature?.properties ?? {};
        const title =
          properties.Name ||
          properties.NAME ||
          properties.FAULT_NAME ||
          properties.Type ||
          properties.TYPE ||
          'Myanmar tectonic lineament';

        layer.bindTooltip(String(title));
      }
    }).addTo(map);
    eventLayerRef.current = L.layerGroup().addTo(map);
    map.fitBounds(
      [
        [boundaryBox.minLatitude, boundaryBox.minLongitude],
        [boundaryBox.maxLatitude, boundaryBox.maxLongitude]
      ],
      { padding: [18, 18] }
    );

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      tectonicLayerRef.current = null;
      eventLayerRef.current = null;
    };
  }, [boundaryBox, boundaryFeature]);

  useEffect(() => {
    if (!tectonicLayerRef.current) {
      return;
    }

    tectonicLayerRef.current.clearLayers();

    if (showTectonics && tectonicCollection) {
      tectonicLayerRef.current.addData(tectonicCollection);
    }
  }, [showTectonics, tectonicCollection]);

  useEffect(() => {
    if (!eventLayerRef.current) {
      return;
    }

    const layerGroup = eventLayerRef.current;
    layerGroup.clearLayers();

    events.forEach((feature) => {
      const [longitude, latitude] = feature.geometry.coordinates;
      const marker = L.circleMarker([latitude, longitude], getMarkerStyle(feature));
      marker.bindTooltip(
        `<strong>M ${formatMagnitude(feature?.properties?.mag ?? NaN)}</strong><br/>${feature?.properties?.place ?? 'Unknown location'}<br/>${formatUtcDate(feature?.properties?.time)}`
      );
      marker.addTo(layerGroup);
    });
  }, [events]);

  return <div ref={containerRef} className="leaflet-map" />;
}

function App() {
  const [boundaryState, setBoundaryState] = useState({
    collection: null,
    feature: null,
    box: null
  });
  const [earthquakes, setEarthquakes] = useState([]);
  const [tectonicState, setTectonicState] = useState({
    collection: null,
    isLoading: true,
    error: null
  });
  const [syncState, setSyncState] = useState({
    phase: 'loading',
    fetchedCount: 0,
    pagesLoaded: 0,
    lastSyncedAt: null,
    updatedAfter: null,
    nextRefreshAt: null,
    refreshStatus: 'idle',
    error: null
  });
  const [filters, setFilters] = useState({
    search: '',
    minMagnitude: 0,
    yearStart: 1900,
    yearEnd: currentYear
  });
  const [showTectonics, setShowTectonics] = useState(true);
  const syncStateRef = useRef(syncState);

  useEffect(() => {
    syncStateRef.current = syncState;
  }, [syncState]);

  useEffect(() => {
    let active = true;

    fetch('./mm_national_boun.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Boundary file failed with ${response.status}`);
        }

        return response.json();
      })
      .then((payload) => {
        if (active) {
          const feature = payload?.features?.[0] ?? null;
          const box = feature ? computeBoundaryBox(feature.geometry) : null;

          setBoundaryState({
            collection: payload,
            feature,
            box
          });
        }
      })
      .catch((error) => {
        if (active) {
          setSyncState((current) => ({
            ...current,
            phase: 'error',
            error: error.message
          }));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    fetch(TECTONIC_LAYER_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Tectonic layer failed with ${response.status}`);
        }

        return response.json();
      })
      .then((payload) => {
        if (active) {
          setTectonicState({
            collection: payload,
            isLoading: false,
            error: null
          });
        }
      })
      .catch((error) => {
        if (active) {
          setTectonicState({
            collection: null,
            isLoading: false,
            error: error.message
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const boundaryFeature = boundaryState.feature;
  const boundaryBox = boundaryState.box;

  useEffect(() => {
    if (!boundaryFeature || !boundaryBox) {
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    async function loadHistoricalCatalog() {
      setEarthquakes([]);
      setSyncState({
        phase: 'loading',
        fetchedCount: 0,
        pagesLoaded: 0,
        lastSyncedAt: null,
        updatedAfter: null,
        nextRefreshAt: null,
        refreshStatus: 'idle',
        error: null
      });

      try {
        const result = await streamHistoricalEarthquakes({
          boundaryBox,
          boundaryFeature,
          signal: controller.signal,
          onBatch: ({ features, fetchedCount, page }) => {
            if (!active) {
              return;
            }

            if (features.length > 0) {
              setEarthquakes((current) => mergeEarthquakes(current, features));
            }

            setSyncState((current) => ({
              ...current,
              phase: 'loading',
              fetchedCount,
              pagesLoaded: page
            }));
          }
        });

        if (!active) {
          return;
        }

        const syncedAt = new Date().toISOString();

        setSyncState({
          phase: 'ready',
          fetchedCount: result.fetchedCount,
          pagesLoaded: result.page,
          lastSyncedAt: syncedAt,
          updatedAfter: syncedAt,
          nextRefreshAt: Date.now() + POLL_INTERVAL_MS,
          refreshStatus: 'idle',
          error: null
        });
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }

        setSyncState((current) => ({
          ...current,
          phase: 'error',
          error: error.message ?? 'Unable to load the earthquake catalog'
        }));
      }
    }

    loadHistoricalCatalog();

    return () => {
      active = false;
      controller.abort();
    };
  }, [boundaryBox, boundaryFeature]);

  async function pollForUpdates() {
    const snapshot = syncStateRef.current;

    if (
      !boundaryFeature ||
      !boundaryBox ||
      snapshot.phase !== 'ready' ||
      !snapshot.updatedAfter ||
      snapshot.refreshStatus === 'checking'
    ) {
      return;
    }

    const controller = new AbortController();
    const requestStartedAt = new Date().toISOString();

    try {
      setSyncState((current) => ({
        ...current,
        refreshStatus: 'checking'
      }));

      const updatedEvents = await fetchRealtimeUpdates({
        boundaryBox,
        boundaryFeature,
        updatedAfter: snapshot.updatedAfter,
        signal: controller.signal
      });

      if (updatedEvents.length > 0) {
        setEarthquakes((current) => mergeEarthquakes(current, updatedEvents));
      }

      setSyncState((current) => ({
        ...current,
        refreshStatus: 'idle',
        lastSyncedAt: requestStartedAt,
        updatedAfter: requestStartedAt,
        nextRefreshAt: Date.now() + POLL_INTERVAL_MS,
        error: null
      }));
    } catch (error) {
      setSyncState((current) => ({
        ...current,
        refreshStatus: 'error',
        nextRefreshAt: Date.now() + POLL_INTERVAL_MS,
        error: error.message ?? 'Automatic refresh failed'
      }));
    }
  }

  useEffect(() => {
    if (syncState.phase !== 'ready') {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      pollForUpdates();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [syncState.phase, boundaryFeature]);

  const dataMinYear =
    earthquakes.length > 0
      ? Math.min(...earthquakes.map((feature) => getEventYear(feature)))
      : 1900;
  const dataMaxYear =
    earthquakes.length > 0
      ? Math.max(...earthquakes.map((feature) => getEventYear(feature)))
      : currentYear;
  const yearStart = Math.max(dataMinYear, Math.min(filters.yearStart, filters.yearEnd));
  const yearEnd = Math.min(dataMaxYear, Math.max(filters.yearStart, filters.yearEnd));
  const searchValue = filters.search.trim().toLowerCase();

  const filteredEarthquakes = earthquakes.filter((feature) => {
    const magnitude = feature?.properties?.mag ?? 0;
    const year = getEventYear(feature);
    const place = feature?.properties?.place?.toLowerCase() ?? '';

    return (
      magnitude >= filters.minMagnitude &&
      year >= yearStart &&
      year <= yearEnd &&
      (searchValue === '' || place.includes(searchValue))
    );
  });

  const yearlySeries = buildYearlySeries(filteredEarthquakes);
  const magnitudeBands = buildMagnitudeBands(filteredEarthquakes);
  const depthBands = buildDepthBands(filteredEarthquakes);
  const strongestEvent = findStrongestEvent(filteredEarthquakes);
  const latestEvent = filteredEarthquakes[0] ?? null;
  const averageDepth = getAverageDepth(filteredEarthquakes);
  const recentEvents = filteredEarthquakes.slice(0, 12);
  const statusIndicator =
    syncState.phase === 'loading' ? 'loading' : syncState.refreshStatus;

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Myanmar Seismic Monitor</p>
          <h1>Historical earthquakes inside Myanmar&apos;s national boundary.</h1>
          <p className="hero-copy">
            The dashboard fetches the USGS earthquake catalog in real time,
            narrows the search to Myanmar&apos;s bounding box, and then applies a
            GeoJSON polygon check against <code>mm_national_boun.json</code> so
            only in-boundary earthquakes are retained.
          </p>
        </div>

        <div className="status-card">
          <div className="status-row">
            <span className={`status-dot status-${statusIndicator}`} />
            <strong>
              {syncState.phase === 'loading'
                ? 'Loading historical catalog'
                : syncState.phase === 'error'
                  ? 'Catalog unavailable'
                  : 'Live updates enabled'}
            </strong>
          </div>
          <p>
            Pages loaded: {syncState.pagesLoaded} · USGS records scanned:{' '}
            {syncState.fetchedCount.toLocaleString()} · In-boundary events:{' '}
            {earthquakes.length.toLocaleString()}
          </p>
          <p>
            Last sync: {formatUtcDate(syncState.lastSyncedAt)} · Next refresh:{' '}
            {formatUtcDate(syncState.nextRefreshAt)}
          </p>
          <p>
            Tectonic layer:{' '}
            {tectonicState.isLoading
              ? 'loading'
              : tectonicState.error
                ? 'unavailable'
                : `${countLineamentFeatures(tectonicState.collection).toLocaleString()} lineaments`}
          </p>
          <div className="status-actions">
            <button
              type="button"
              onClick={pollForUpdates}
              disabled={syncState.phase !== 'ready' || syncState.refreshStatus === 'checking'}
            >
              {syncState.refreshStatus === 'checking' ? 'Checking…' : 'Refresh now'}
            </button>
            <span className="boundary-chip">
              Boundary: {boundaryFeature?.properties?.CRTY_NAME ?? 'Myanmar'}
            </span>
          </div>
          {syncState.error ? <p className="error-copy">{syncState.error}</p> : null}
          {tectonicState.error ? <p className="error-copy">{tectonicState.error}</p> : null}
        </div>
      </section>

      <section className="stats-grid">
        <StatCard
          label="Catalog size"
          value={filteredEarthquakes.length.toLocaleString()}
          note={`Filtered from ${earthquakes.length.toLocaleString()} in-boundary events`}
        />
        <StatCard
          label="Strongest event"
          value={`M ${formatMagnitude(strongestEvent?.properties?.mag ?? NaN)}`}
          note={strongestEvent?.properties?.place ?? 'No event in view'}
        />
        <StatCard
          label="Average depth"
          value={formatDepth(averageDepth)}
          note="Across the current filter selection"
        />
        <StatCard
          label="Latest event"
          value={formatUtcDate(latestEvent?.properties?.time)}
          note={latestEvent?.properties?.place ?? 'No event in view'}
        />
      </section>

      <section className="dashboard-grid">
        <section className="panel controls-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Filters</p>
              <h2>Refine the catalog</h2>
            </div>
          </div>

          <label className="filter-field">
            <span>Search place name</span>
            <input
              type="search"
              placeholder="Sagaing, Mandalay, Naypyidaw…"
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value
                }))
              }
            />
          </label>

          <label className="filter-field">
            <span>Minimum magnitude</span>
            <input
              type="range"
              min="0"
              max="8"
              step="0.1"
              value={filters.minMagnitude}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  minMagnitude: Number(event.target.value)
                }))
              }
            />
            <strong>{filters.minMagnitude.toFixed(1)}</strong>
          </label>

          <label className="filter-field">
            <span>Start year</span>
            <input
              type="range"
              min={dataMinYear}
              max={dataMaxYear}
              value={yearStart}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  yearStart: Number(event.target.value)
                }))
              }
            />
            <strong>{yearStart}</strong>
          </label>

          <label className="filter-field">
            <span>End year</span>
            <input
              type="range"
              min={dataMinYear}
              max={dataMaxYear}
              value={yearEnd}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  yearEnd: Number(event.target.value)
                }))
              }
            />
            <strong>{yearEnd}</strong>
          </label>

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={showTectonics}
              onChange={(event) => setShowTectonics(event.target.checked)}
            />
            <span>Show Myanmar tectonic lineaments</span>
          </label>
          <p className="filter-note">
            The lineament layer is loaded from{' '}
            <a href={TECTONIC_LAYER_URL} target="_blank" rel="noreferrer">
              the tectonic GeoJSON source
            </a>{' '}
            and drawn above the national boundary for tectonic context.
          </p>
        </section>

        <section className="panel map-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Spatial view</p>
              <h2>Events retained after boundary filtering</h2>
            </div>
            <p className="panel-note">
              Marker size tracks magnitude. Color tracks depth.
            </p>
          </div>

          <div className="map-frame">
            {boundaryFeature && boundaryBox ? (
              <MyanmarMap
                boundaryFeature={boundaryFeature}
                boundaryBox={boundaryBox}
                tectonicCollection={tectonicState.collection}
                showTectonics={showTectonics}
                events={filteredEarthquakes}
              />
            ) : (
              <div className="empty-state">Loading Myanmar boundary geometry…</div>
            )}
          </div>
        </section>

        <section className="panel chart-panel timeline-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Temporal profile</p>
              <h2>Earthquake counts by year</h2>
            </div>
          </div>
          <div className="chart-frame">
            <TrendChart data={yearlySeries} />
          </div>
        </section>

        <section className="panel chart-panel magnitude-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Magnitude distribution</p>
              <h2>How strong the retained events are</h2>
            </div>
          </div>
          <div className="chart-frame">
            <MagnitudeChart data={magnitudeBands} />
          </div>
        </section>

        <section className="panel chart-panel depth-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Depth profile</p>
              <h2>Shallow vs intermediate vs deep</h2>
            </div>
          </div>
          <div className="chart-frame compact-chart">
            <DepthDistribution data={depthBands} />
          </div>
        </section>

        <section className="panel table-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Recent events</p>
              <h2>Latest earthquakes in the current filter</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time (UTC)</th>
                  <th>Mag</th>
                  <th>Depth</th>
                  <th>Coordinates</th>
                  <th>Place</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((feature) => (
                  <tr key={feature.id}>
                    <td>{formatUtcDate(feature?.properties?.time)}</td>
                    <td>
                      <a href={feature?.properties?.url} target="_blank" rel="noreferrer">
                        {formatMagnitude(feature?.properties?.mag ?? NaN)}
                      </a>
                    </td>
                    <td>{formatDepth(feature?.geometry?.coordinates?.[2] ?? NaN)}</td>
                    <td>
                      {formatCoordinate(feature?.geometry?.coordinates?.[1])},{' '}
                      {formatCoordinate(feature?.geometry?.coordinates?.[0])}
                    </td>
                    <td>{feature?.properties?.place ?? 'Unknown location'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
