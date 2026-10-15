// The map library, loaded only when somebody opens a map.
//
// MapLibre is about 600 KB before its worker, and a general contractor opens
// the Jobs map a few times a week while every visit to every screen would pay
// for it if it sat in the main bundle. So the map component imports this file
// with a dynamic import() and nothing else in the app references it.
//
// The worker is the one thing that will not bundle on its own: MapLibre finds
// it with `new URL(name, import.meta.url)` where the name is a variable, which
// Vite cannot see, so in a build the worker file is simply not there. Asking
// Vite for it as a worker (`?worker&url`) bundles it with the shared chunk it
// imports and hands back the address, and setWorkerUrl points MapLibre at it.
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";

maplibregl.setWorkerUrl(workerUrl);

export default maplibregl;
