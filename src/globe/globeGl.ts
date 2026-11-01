// The globe drawn on the GPU (WebGL2), in one fragment shader over one triangle:
//  - the surface: the sea coloured by its floor (NASA's shaded relief and bathymetry: the shelves lighter, the deep dark,
//    ridges and trenches in relief), with the sky's reflection at a glancing view and the sun's glint, broken into the
//    waves' sparkle as the view closes in; the land as NASA's Blue Marble shows it (a cloud-free picture:
//    the whole world's, and the part in view sharper once zoomed in — detail.ts; drawn colours, greener at the coasts
//    and drier inland, until the picture is in), crisp coastlines (the picture's own once it is sharp), the sun's real day
//    and night with a warm twilight band and a glint on the water, a faint coastline (brighter by night). Zoomed in,
//    the land comes from a cache of NASA's tiles on the GPU (a texture array, one tile a layer, and a page table saying
//    which layer holds which tile of which level): each pixel shows the finest tile held at the level its size on screen
//    calls for, over the coarser ones held beneath, each fading in as it arrives — so the land sharpens tile by tile as
//    the view moves and zooms, and never waits for a whole view;
//  - the clouds: a translucent layer just above the surface (its parallax gives depth as the globe turns): where a
//    satellite saw them (NOAA's infrared mosaic, satClouds.ts) between 72°S and 72°N, with the weather model's cloud (any
//    height, its shapes drawn) faint where the satellite shows less — mostly low cloud, which infrared barely sees; the
//    model's and the cities' own reports (cloudField.ts) beyond the image's edges or without an image. Zoomed in, the
//    infrared of the satellite overhead (~2 km, the same hour) sharpens them where the world's satellite image shows
//    cloud, and nowhere else: its fine structure cuts their edges and raises their tops; by day its visible band (~1 km)
//    draws them as a camera saw them — their own shapes, texture and shading — where it has a picture. Lit by the sun (bright by
//    day, sunset-coloured at the terminator, moonlit grey at night; the sharp tops shaded on their far side), darker
//    where it rains, lit from within by soft flashes of lightning in thick storm cloud, casting soft shadows on the ground;
//  - the atmosphere's glow, brighter on the sunlit limb.
// The model's cloud shapes — swirling noise, more of it where the data says the sky is cloudier — are costly, so the
// clouds are baked into a world map (4096 × 2048, or 2048 × 1024 where the GPU holds no larger texture) by a second shader
// into a spare map that takes over when it is done: a strip per frame (the globe asks for frames while it is `busy`), or
// all at once under reduced motion. A bake runs only when the data or the satellite image changes. Each frame then only
// samples the map. A redraw costs the CPU nothing. Null where WebGL2 is unavailable — the SVG globe is drawn
// instead.
import { landMask } from "./landMask"
import { SURFACE_MAX_LEVEL, SURFACE_MIN_LEVEL, TILE_PX, tileCols, tileRes, tileRows } from "../geo/tiles"
import { FIELD_H, FIELD_W, type CloudField } from "./cloudField"

const RAD = Math.PI / 180
/** the cloud map's size where the GPU allows it */
export const CLOUD_MAP_W = 4096
export const CLOUD_MAP_H = 2048
const STRIPS = 32
/** the land's page table: a block of rows a level, from the coarsest (its tiles across and down) to the finest */
const PAGE_COLS0 = tileCols(SURFACE_MIN_LEVEL), PAGE_ROWS0 = tileRows(SURFACE_MIN_LEVEL)
const PAGE_W = PAGE_COLS0 * 2 ** (SURFACE_MAX_LEVEL - SURFACE_MIN_LEVEL)
const PAGE_H = PAGE_ROWS0 * (2 ** (SURFACE_MAX_LEVEL - SURFACE_MIN_LEVEL + 1) - 1)
const pageRow = (z: number, row: number): number => PAGE_ROWS0 * (2 ** (z - SURFACE_MIN_LEVEL) - 1) + row
/** the tiles the land's cache holds (a 512-px tile is 1 MiB): more on a GPU that holds large textures */
const CACHE_TILES_LARGE = 96, CACHE_TILES = 48
/** a level's pixels may be this much coarser than the screen's (as detail.ts plans) */
const LEVEL_SLACK = 1.25
/** a land tile fades in over this long */
const TILE_FADE_MS = 350

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`

const NOISE = `
float hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    v += a * vnoise(p);
    p = p * 2.03 + vec3(17.1, 3.3, 9.7);
    a *= 0.5;
  }
  return v;
}`

// The cloud map, one texel per world direction (longitude across, latitude down, like the land texture):
// r = how much cloud, g = how much of it is high cloud, b = rain, a = thunderstorm.
const BAKE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_field;          // the model's evidence-weighted cover, high cover, rain, storm
uniform sampler2D u_fieldValidity;  // the known-sample weight for each model channel
uniform sampler2D u_sat;            // the satellite: cloud, high cold cloud, -, coverage (satClouds.ts)
uniform float u_satOn;
uniform vec2 u_satLat;      // the satellite image's top and bottom latitudes (°)
uniform float u_time;
uniform vec2 u_size;
out vec4 outColor;
const float PI = 3.14159265358979;
// the satellite fades into the model's clouds over its last degrees before its edges
const float SAT_FADE_DEG = 6.0;
// the model's cloud (any height) where the satellite shows less — mostly low cloud, too warm to show in infrared —
// drawn this faint
const float LOW_FILL = 0.2;
${NOISE}
// the model's clouds here (how much, the share of it that is high): swirling noise, as much as the data's cover
vec2 modelClouds(vec4 cd, float lon, float lat) {
  if (cd.r < 0.012 && cd.g < 0.03) return vec2(0.0);
  float cl = cos(lat);
  // the noise drifts slowly east and changes shape; squeezed north-south so systems stretch along the westerlies
  float a = u_time * 0.0004;
  vec3 w = vec3(cl * cos(lon + a), cl * sin(lon + a), sin(lat) * 1.7);
  vec3 q = w * 3.2;
  vec3 warp = vec3(fbm(q + vec3(1.7, 9.2, 0.3), 3), fbm(q + vec3(8.3, 2.8, 5.1), 3), fbm(q + vec3(3.1, 5.7, 4.4), 3));
  float n = fbm(q * 1.9 + warp * 1.5 + vec3(0.0, 0.0, u_time * 0.003), 6);
  float thr = mix(0.70, 0.20, cd.r);
  // thicker in the cores than at the edges, so even an overcast sheet keeps its texture
  float low = smoothstep(thr, thr + 0.11, n) * mix(0.72, 1.0, smoothstep(thr, thr + 0.45, n));
  // cumulus edges: fine noise eats into the thinner parts
  low *= mix(0.55, 1.0, smoothstep(0.25, 0.75, fbm(w * 26.0 + 11.0, 2) + low * 0.5));
  float hi = 0.0;
  if (cd.g >= 0.03) {
    float hiT = mix(0.80, 0.44, cd.g);
    hi = smoothstep(hiT, hiT + 0.18, fbm(vec3(w.x * 7.0, w.y * 7.0, w.z * 2.0) + warp * 0.8 + 31.0, 4)) * 0.5;
  }
  float dens = clamp(max(low, hi), 0.0, 1.0);
  return vec2(dens, dens > 0.0 ? hi / max(dens, 1e-3) : 0.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  float lon = (uv.x - 0.5) * 2.0 * PI, lat = (0.5 - uv.y) * PI;
  vec4 field = texture(u_field, uv), known = texture(u_fieldValidity, uv);
  // Both textures are premultiplied by known-sample weight: dividing after interpolation keeps transparent unknowns
  // from becoming zero-valued evidence. With no known samples this remains zero, so no model cloud or storm is drawn.
  vec4 cd = clamp(field / max(known, vec4(1e-6)), 0.0, 1.0);
  float satW = 0.0;
  vec4 sd = vec4(0.0);
  if (u_satOn > 0.5) {
    float latDeg = lat * 180.0 / PI;
    float v = (u_satLat.x - latDeg) / (u_satLat.x - u_satLat.y);
    if (v > 0.0 && v < 1.0) {
      sd = texture(u_sat, vec2(uv.x, v));
      satW = step(0.5, sd.a) * smoothstep(0.0, SAT_FADE_DEG, min(u_satLat.x - latDeg, latDeg - u_satLat.y));
    }
  }
  // the model's noise only where it can show: not under the satellite's own cloud, which the faint fill cannot pass
  vec2 model = satW >= 0.999 && sd.r >= LOW_FILL ? vec2(0.0) : modelClouds(cd, lon, lat);
  float fill = model.x * LOW_FILL;
  float sat = max(sd.r, fill);
  float satHi = sd.r >= fill && sd.r > 0.0 ? sd.g / max(sd.r, 1e-3) : 0.0;
  outColor = vec4(mix(model.x, sat, satW), mix(model.y, satHi, satW), cd.b, cd.a);
}`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform vec2 u_center;   // globe centre, device px, origin bottom-left
uniform float u_radius;  // device px
uniform vec2 u_view;     // the point under the camera: lon, lat (radians)
uniform vec3 u_sun;      // the sun's direction in camera space: x right, y up, z toward the viewer
uniform sampler2D u_land;
uniform sampler2D u_cmap;
uniform float u_cloudOn;
uniform float u_time;    // seconds: the lightning
uniform float u_lightning; // 1 = lightning is drawn (the view is close enough to see it)
uniform float u_lod;     // the cloud map's mip level at the disk's centre (texels per device pixel, log 2)
uniform sampler2D u_photo;   // NASA's Blue Marble, the whole world
uniform float u_photoOn;     // 0 = no picture yet: the drawn colours
uniform sampler2D u_bathy;   // NASA's shaded relief and bathymetry, the whole world: the sea's colour
uniform float u_bathyOn;
uniform sampler2DArray u_atlas;   // the land's tiles the cache holds, one a layer
uniform highp sampler2D u_page;   // for each tile of each level: its layer + 1 (0 = not held), when it came in (s)
uniform float u_atlasOn;
uniform float u_nowS;             // seconds, on the page table's clock
uniform sampler2D u_dCloud;  // the clouds in view: r = colder than around it (0.5 = no different), g = its trust,
                             // b = cloud as the visible band shows it, a = its trust (by day, with a picture)
uniform vec4 u_dCloudBox;
uniform vec2 u_dCloudPx;
uniform float u_dCloudOn;
uniform vec2 u_cmapPx;       // the cloud map's size in texels
uniform sampler2D u_satC;    // the satellite's own cloud (satClouds.ts), to say where the fine structure may act
uniform vec2 u_satCLat;      // its top and bottom latitudes (°)
uniform float u_satCOn;
out vec4 outColor;
const float PI = 3.14159265358979;
const float ATMO = 0.085;
const float RC = 1.014;  // the cloud layer's radius (the Earth's = 1)
// kelvin colder than around it per step of the fine structure, and the kelvin that make a whole cloud of difference
const float HF_K = 79.7;
const float HF_FULL_K = 22.0;
${NOISE}
// a camera-space unit vector → lon, lat
vec2 latLon(vec3 c) {
  float sp0 = sin(u_view.y), cp0 = cos(u_view.y);
  return vec2(u_view.x + atan(c.x, c.z * cp0 - c.y * sp0), asin(clamp(c.y * cp0 + c.z * sp0, -1.0, 1.0)));
}
vec3 worldDir(vec2 ll) { float cl = cos(ll.y); return vec3(cl * cos(ll.x), cl * sin(ll.x), sin(ll.y)); }
vec2 uvOf(vec2 ll) { return vec2(ll.x / (2.0 * PI) + 0.5, 0.5 - ll.y / PI); }
// an equirectangular texture without a seam where longitude wraps
vec4 sampleWrapped(sampler2D t, vec2 uv) {
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  return textureGrad(t, uv, dx, dy);
}
// a texture read with a cubic B-spline between its texels (four bilinear reads): smooth where it is magnified, never
// its texels' blocks
vec4 cubic(sampler2D t, vec2 uv, vec2 size) {
  vec2 st = uv * size - 0.5, i = floor(st), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / size, h1 = (i + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * textureLod(t, h0, 0.0) + g1.x * textureLod(t, vec2(h1.x, h0.y), 0.0))
       + g1.y * (g0.x * textureLod(t, vec2(h0.x, h1.y), 0.0) + g1.x * textureLod(t, h1, 0.0));
}
// where a point falls in a box of the world (west, south, east, north): its uv, and how far inside it is (a share of
// the box; below 0 outside)
vec3 inBox(vec2 ll, vec4 box) {
  float lon = ll.x - 2.0 * PI * floor((ll.x - box.x) / (2.0 * PI));
  vec2 uv = vec2((lon - box.x) / (box.z - box.x), (box.w - ll.y) / (box.w - box.y));
  return vec3(uv, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
}
// how much of a sharp texture to use here: fading in from its box's edges, and none where it would be shrunk (more than
// a texel and a half to a pixel: the world's own picture, with its mip levels, looks better there)
float sharpWeight(vec3 b, vec2 texels) {
  vec2 t = b.xy * texels;
  float fp = max(length(dFdx(t)), length(dFdy(t)));
  return b.z > 0.0 ? smoothstep(0.0, 0.03, b.z) * (1.0 - smoothstep(1.5, 3.0, fp)) : 0.0;
}
// the land's sharp picture here, premultiplied (its colour × how much, how much): the finest tile the cache holds at the
// level this pixel's size on screen calls for, over the coarser ones held beneath it (each faded in as it came)
const float TILE_RES0 = ${tileRes(0)};
const int ZMIN = ${SURFACE_MIN_LEVEL}, ZMAX = ${SURFACE_MAX_LEVEL};
const int PAGE_COLS0 = ${PAGE_COLS0}, PAGE_ROWS0 = ${PAGE_ROWS0};
const float LEVEL_SLACK = ${LEVEL_SLACK};
const float TILE_FADE_S = ${TILE_FADE_MS / 1000};
vec4 atlasAt(vec2 g, float degPerPx) {
  float zf = log2(TILE_RES0 / (degPerPx * LEVEL_SLACK));
  if (zf < float(ZMIN) - 1.0) return vec4(0.0);
  vec4 acc = vec4(0.0);
  int z = clamp(int(ceil(zf)), ZMIN, ZMAX);
  for (int k = 0; k <= ZMAX - ZMIN; k++) {
    if (z < ZMIN || acc.a > 0.995) break;
    int n = 1 << (z - ZMIN);
    float span = TILE_RES0 * 512.0 / exp2(float(z));
    vec2 t = vec2((g.x + 180.0) / span, (90.0 - g.y) / span);
    ivec2 cr = clamp(ivec2(floor(t)), ivec2(0), ivec2(PAGE_COLS0 * n - 1, PAGE_ROWS0 * n - 1));
    vec2 pg = texelFetch(u_page, ivec2(cr.x, PAGE_ROWS0 * (n - 1) + cr.y), 0).rg;
    if (pg.x > 0.5) {
      vec2 uv = clamp(t - vec2(cr), 0.5 / 512.0, 1.0 - 0.5 / 512.0);
      float f = clamp((u_nowS - pg.y) / TILE_FADE_S, 0.0, 1.0);
      acc += vec4(textureLod(u_atlas, vec3(uv, pg.x - 1.0), 0.0).rgb * f, f) * (1.0 - acc.a);
    }
    z--;
  }
  // zoomed out past the coarsest level, the world picture takes over
  return acc * smoothstep(float(ZMIN) - 1.0, float(ZMIN) - 0.4, zf);
}

void main() {
  vec2 p = (gl_FragCoord.xy - u_center) / u_radius;
  float d = length(p);
  float px = 1.5 / u_radius;
  vec2 dir = d > 1e-5 ? p / d : vec2(0.0, 1.0);
  float limbLit = smoothstep(-0.35, 0.5, dot(dir, u_sun.xy) + 0.2 * u_sun.z);
  vec3 glow = mix(vec3(0.09, 0.14, 0.38), vec3(0.45, 0.74, 1.0), limbLit);
  float t = max(d - 1.0, 0.0) / ATMO;
  float haloA = pow(1.0 - min(t, 1.0), 2.2) * (0.22 + 0.5 * limbLit);
  vec4 res = vec4(glow * haloA, haloA);

  if (d <= 1.0 + px) {
    float z = sqrt(max(0.0, 1.0 - d * d));
    vec3 n = vec3(p, z);
    vec2 ll = latLon(n);
    float lat = ll.y;
    vec3 tex = sampleWrapped(u_land, uvOf(ll)).rgb;
    float land = tex.r, coast = tex.g, inland = tex.b;
    float alat = abs(lat) * 180.0 / PI;
    // the land as the picture shows it: the world's, the sharp one in view over it as its tiles come in
    vec3 photo = vec3(0.0);
    float sharp = 0.0;
    if (u_photoOn > 0.5) {
      photo = sampleWrapped(u_photo, uvOf(ll)).rgb;
      if (u_atlasOn > 0.5) {
        // degrees (longitude in -180..180) and how many of them a pixel spans here
        vec2 g = vec2(mod(ll.x * 180.0 / PI + 180.0, 360.0) - 180.0, ll.y * 180.0 / PI);
        vec2 gx = dFdx(g), gy = dFdy(g);
        gx.x -= 360.0 * floor(gx.x / 360.0 + 0.5);
        gy.x -= 360.0 * floor(gy.x / 360.0 + 0.5);
        vec4 a = atlasAt(g, max(max(length(gx), length(gy)), 1e-7));
        photo = a.rgb + photo * (1.0 - a.a);
        sharp = a.a;
      }
    }

    vec3 ocean = mix(vec3(0.028, 0.082, 0.190), vec3(0.050, 0.165, 0.320), 0.3 + 0.7 * z);
    // the shallows' glow follows the outline, too coarse to show where the sharp picture draws the coast
    ocean = mix(ocean, vec3(0.085, 0.320, 0.420), smoothstep(0.04, 0.7, coast) * 0.8 * (1.0 - sharp));
    if (u_bathyOn > 0.5) {
      // the sea as its floor colours it; where the picture's pixel is part land (at a coast) the drawn shallows stay
      vec3 bed = sampleWrapped(u_bathy, uvOf(ll)).rgb;
      float seaPx = smoothstep(0.0, 0.06, bed.b - max(bed.r, bed.g * 0.85));
      // (lifted on a curve and toward blue: the deep as bright as the drawn sea was, the shelves brighter still, the relief
      // kept)
      ocean = mix(ocean, pow(bed, vec3(0.8)) * vec3(1.0, 1.12, 1.2), seaPx);
    }
    ocean = mix(ocean, vec3(0.70, 0.80, 0.88), smoothstep(70.0, 80.0, alat) * 0.35);
    vec3 ground = mix(vec3(0.17, 0.40, 0.29), vec3(0.40, 0.46, 0.28), smoothstep(0.5, 0.95, inland));
    ground = mix(ground, vec3(0.58, 0.51, 0.34), smoothstep(0.82, 1.0, inland) * smoothstep(8.0, 20.0, alat) * (1.0 - smoothstep(36.0, 46.0, alat)));
    ground = mix(ground, vec3(0.42, 0.50, 0.48), smoothstep(52.0, 64.0, alat));
    float ice = lat < 0.0 ? smoothstep(58.0, 66.0, alat) : smoothstep(68.0, 76.0, alat);
    ground = mix(ground, vec3(0.86, 0.91, 0.96), ice);
    // the coast stays crisp at every zoom: the land's edge is cut where the texture crosses half, a pixel or two wide
    float fwL = max(fwidth(land), 1e-4);
    float landK = smoothstep(0.5 - fwL, 0.5 + fwL, land);
    float coastLine = 1.0 - smoothstep(0.0, 1.6 * fwL, abs(land - 0.5));
    // where the sharp picture shows, its own water draws the coast, finer than the outline: the sea and lakes in it are
    // near black with all but no red, and no bluer than the darkest forest is red
    if (u_photoOn > 0.5) {
      float water = (1.0 - smoothstep(0.014, 0.03, photo.r)) * smoothstep(-0.008, 0.012, photo.b - photo.r);
      landK = mix(landK, 1.0 - water, sharp);
      coastLine *= 1.0 - sharp;
      ground = photo;
    }
    vec3 base = mix(ocean, ground, landK);

    float cosZ = dot(n, u_sun);
    float day = smoothstep(-0.10, 0.18, cosZ);
    vec3 lit = base * (0.62 + 0.48 * clamp(cosZ, 0.0, 1.0));
    vec3 night = base * vec3(0.26, 0.33, 0.54) + vec3(0.020, 0.034, 0.080);
    vec3 col = mix(night, lit, day);
    col += vec3(1.0, 0.48, 0.22) * 0.10 * exp(-pow(cosZ / 0.07, 2.0));
    // the sea's sheen: the sky it reflects, more at a glancing view (toward the limb), and the sun's glint — a broad
    // sheen and a hot core, broken by the waves' sparkle once the view is close enough to see them
    float sea = 1.0 - landK;
    float fres = 0.02 + 0.6 * pow(1.0 - z, 5.0);
    col = mix(col, vec3(0.55, 0.70, 0.90), fres * sea * day * 0.6);
    vec3 r = reflect(-u_sun, n);
    float rz = max(r.z, 0.0);
    float waves = u_radius > 1200.0 ? 0.35 + 1.3 * vnoise(worldDir(ll) * u_radius * 0.35) : 1.0;
    col += vec3(1.0, 0.93, 0.80) * (0.18 * pow(rz, 30.0) + 0.6 * pow(rz, 400.0) * waves) * sea * day;
    // the clouds' shadow: the cloud the sunlight passes through on its way down (cast less far as the view closes in, where
    // the layer's height is drawn larger than it is)
    if (u_cloudOn > 0.5) {
      float sh = textureLod(u_cmap, uvOf(latLon(normalize(n + u_sun * 0.03 * min(1.0, 900.0 / u_radius)))), max(u_lod + 1.5, 0.0)).r;
      col *= 1.0 - 0.38 * sh * day;
    }

    // a faint coastline, brighter by night so the land still reads in the dark (less so over the picture, which shows it)
    col = mix(col, vec3(0.55, 0.78, 0.95), coastLine * (0.16 + (u_photoOn > 0.5 ? 0.12 : 0.26) * (1.0 - day)));

    col += glow * pow(1.0 - z, 2.4) * (0.18 + 0.55 * limbLit);
    float inside = 1.0 - smoothstep(1.0 - px, 1.0 + px, d);
    res = vec4(col, 1.0) * inside + res * (1.0 - inside);
  }

  if (u_cloudOn > 0.5 && d < RC) {
    vec3 pc = vec3(p, sqrt(max(0.0, RC * RC - d * d))) / RC;
    vec2 ll = latLon(pc);
    // magnified, the map is read smoothly between its texels
    vec4 cm = u_lod < -0.5 ? cubic(u_cmap, uvOf(ll), u_cmapPx) : sampleWrapped(u_cmap, uvOf(ll));
    // the clouds in view, sharper: by day, as the satellite's camera saw them (their own shapes and texture); else its
    // infrared's fine structure — colder than around it = more cloud and a taller top, warmer = less — acting only near
    // the cloud the world's satellite image itself shows (not the model's faint fill), so the ground's own warm and cold
    // patches never make cloud
    float sharpC = 0.0, hf = 0.0, visW = 0.0, vis = 0.0;
    if (u_dCloudOn > 0.0) {
      vec3 bc = inBox(ll, u_dCloudBox);
      float inC = sharpWeight(bc, u_dCloudPx) * u_dCloudOn;
      if (inC > 0.0) {
        vec4 dc = cubic(u_dCloud, clamp(bc.xy, 0.0, 1.0), u_dCloudPx);
        visW = inC * dc.a;
        vis = dc.b;
        if (u_satCOn > 0.5) {
          float v = (u_satCLat.x - ll.y * 180.0 / PI) / (u_satCLat.x - u_satCLat.y);
          float near = v > 0.0 && v < 1.0 ? smoothstep(0.12, 0.4, textureLod(u_satC, vec2(uvOf(ll).x, v), 2.0).r) : 0.0;
          sharpC = inC * dc.g * near * (1.0 - visW);
          hf = (dc.r - 0.502) * HF_K;
        }
      }
    }
    float relief = mix(cm.r + sharpC * hf / HF_FULL_K, vis, visW);
    if (relief > 0.004) {
      vec3 w = worldDir(ll);
      // fine detail the map is too coarse to hold, zoomed in and only where the cloud is thin (its edges), where the
      // satellite's own is not drawn
      float detail = smoothstep(600.0, 1600.0, u_radius) * (1.0 - min(1.0, sharpC * 4.0)) * (1.0 - visW);
      float dens = relief;
      if (detail > 0.0) dens += (vnoise(w * 160.0) - 0.5) * 0.45 * detail * cm.r * (1.0 - cm.r);
      dens = clamp(dens, 0.0, 1.0);
      float cz = dot(pc, u_sun);
      float dayC = smoothstep(-0.12, 0.15, cz);
      // sunlit tops white; grey where more cloud stands between this point and the sun (the far side of a cloud), and
      // a little in the thinnest veils
      float self = textureLod(u_cmap, uvOf(latLon(normalize(pc + u_sun * 0.02 * min(1.0, 900.0 / u_radius)))), max(u_lod + 1.0, 0.0)).r;
      // the sharp tops: shaded where the point two texels toward the sun stands taller
      float fine = 0.0;
      if (sharpC > 0.0) {
        vec3 ts = u_sun - pc * dot(u_sun, pc);
        float tl = length(ts);
        if (tl > 1e-4) {
          vec3 b2 = inBox(latLon(normalize(pc + ts * (2.0 * (u_dCloudBox.z - u_dCloudBox.x) / (u_dCloudPx.x * tl)))), u_dCloudBox);
          float hf2 = (textureLod(u_dCloud, clamp(b2.xy, 0.0, 1.0), 0.0).r - 0.502) * HF_K;
          fine = clamp((hf2 - hf) / HF_FULL_K * 2.5, -0.6, 0.6) * sharpC;
        }
      }
      float shade = clamp((self - cm.r) * 1.8 + 0.25 * (1.0 - dens) + fine, 0.0, 1.0);
      // the camera's own light and shade: thin veils grey, thick sunlit tops white
      shade = mix(shade, 0.4 * (1.0 - vis), visW);
      vec3 litC = mix(vec3(1.0), vec3(0.58, 0.62, 0.72), shade) * (0.80 + 0.20 * clamp(cz, 0.0, 1.0));
      litC = mix(litC, litC * vec3(0.52, 0.56, 0.64), cm.b);
      litC = mix(litC, vec3(0.93, 0.95, 1.0), cm.g * 0.5);
      // by night: moonlit grey, the thick parts a little brighter, so the weather still reads in the dark
      vec3 nightC = vec3(0.13, 0.15, 0.22) + vec3(0.05, 0.055, 0.07) * dens * (1.0 - 0.5 * self);
      vec3 cc = mix(nightC, litC, dayC);
      cc += vec3(1.0, 0.55, 0.35) * 0.18 * exp(-pow(cz / 0.07, 2.0));
      // lightning: now and then a soft round glow somewhere inside a cell of the sky — wholly within it, so no cell's
      // edge ever shows — and only where a thunderstorm's cloud is thick
      float flash = 0.0;
      if (u_lightning > 0.5 && cm.a > 0.01 && dens > 0.45) {
        vec3 q = w * 90.0, cell = floor(q);
        float tick = mod(floor(u_time * 5.0), 997.0);
        if (hash3(cell + vec3(tick * 1.7, tick * 0.3, tick * 2.9)) > 0.975) {
          vec3 at = cell + 0.3 + 0.4 * vec3(hash3(cell + 3.1), hash3(cell + 7.7), hash3(cell + 11.3));
          flash = cm.a * (1.0 - smoothstep(0.0, 0.28, length(q - at))) * smoothstep(0.45, 0.8, dens) * (1.0 - fract(u_time * 5.0));
        }
      }
      cc += vec3(0.75, 0.82, 1.0) * flash * 1.4;
      // translucent: thin cloud lets the ground through, even the thickest a little
      // (a cloud the camera saw is as opaque as it looked)
      // (the faintest veils — mostly the infrared's noise — fade out rather than grey the sea)
      float a = pow(dens, 1.25) * smoothstep(0.03, 0.2, dens) * mix(mix(0.6, 0.84, dayC), 0.94, visW * dayC) * (1.0 - smoothstep(RC - 0.012, RC, d));
      res = vec4(cc * a, a) + res * (1.0 - a);
    }
  }
  outColor = res;
}`

export interface GlobeDraw {
  /** the canvas in device px */
  width: number
  height: number
  /** the globe's centre and radius in device px (y down, like the page) */
  cx: number
  cy: number
  r: number
  view: { lon: number; lat: number }
  sun: { lat: number; lon: number }
  /** seconds, for the clouds' drift and the lightning; frozen under reduced motion */
  timeS: number
  clouds: boolean
  /** bake new clouds whole in this draw (reduced motion: no frames follow), not a strip per frame */
  whole?: boolean
  /** draw lightning (the view is close enough to see it) */
  lightning?: boolean
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s
  console.warn("[globe] shader did not compile:", gl.getShaderInfoLog(s))
  gl.deleteShader(s)
  return null
}

function link(gl: WebGL2RenderingContext, frag: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT), fs = compile(gl, gl.FRAGMENT_SHADER, frag)
  const prog = gl.createProgram()
  if (!vs || !fs || !prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.bindAttribLocation(prog, 0, "a_pos")
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (gl.getProgramParameter(prog, gl.LINK_STATUS)) return prog
  console.warn("[globe] program did not link:", gl.getProgramInfoLog(prog))
  return null
}

/** The sun's direction seen from the camera: the same projection as orthoProject, without the horizon cut. */
export function sunInView(sun: { lat: number; lon: number }, view: { lon: number; lat: number }): [number, number, number] {
  const l = (sun.lon - view.lon) * RAD, p = sun.lat * RAD, p0 = view.lat * RAD
  return [
    Math.cos(p) * Math.sin(l),
    Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l),
    Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l),
  ]
}

type Uniform = WebGLUniformLocation | null
/** anisotropic filtering, where the GPU offers it: the picture stays crisp where the globe curves away */
const ANISOTROPY = 8

/** Anisotropic filtering for the texture bound now, where the GPU offers it. */
function anisotropic(gl: WebGL2RenderingContext): void {
  const ext = gl.getExtension("EXT_texture_filter_anisotropic")
  if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(ANISOTROPY, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number))
}
/** a canvas at half its size, for a GPU that holds no texture as large */
function halved(c: HTMLCanvasElement): HTMLCanvasElement {
  const h = document.createElement("canvas")
  h.width = c.width / 2
  h.height = c.height / 2
  h.getContext("2d")?.drawImage(c, 0, 0, h.width, h.height)
  return h
}
/** a sharp texture of the part in view: its tiles' key, its size, and its box (radians: west, south, east, north) */
interface Sharp { key: string; tex: WebGLTexture; w: number; h: number; box: [number, number, number, number] }
/** a land tile the cache holds: which, when the view last wanted it, and when it came in (performance.now) */
interface Held { key: string; z: number; row: number; col: number; usedAt: number; at: number }
/** the land's cache: the tiles (a texture array), the page table, and what each layer holds */
interface Cache { tex: WebGLTexture; page: WebGLTexture; slots: Array<Held | null>; byKey: Map<string, number> }
const tileKey = (z: number, row: number, col: number): string => `${z}/${row}/${col}`
/** a sharp texture fades in over this long when it first shows */
const FADE_MS = 600
const boxRad = (b: { west: number; south: number; east: number; north: number }): [number, number, number, number] =>
  [b.west * RAD, b.south * RAD, b.east * RAD, b.north * RAD]

/** a texture the size given, clamped at its edges, without mip levels (the shader leaves it where it would be shrunk) */
function sharpTexture(gl: WebGL2RenderingContext, w: number, h: number, format: number): WebGLTexture | null {
  const t = gl.createTexture()
  if (!t) return null
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}

/** an RGBA8 texture that wraps round in longitude, with its mip levels when it will be minified */
function texture(gl: WebGL2RenderingContext, w: number, h: number, mips: boolean): WebGLTexture | null {
  const t = gl.createTexture()
  if (!t) return null
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texStorage2D(gl.TEXTURE_2D, mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1, gl.RGBA8, w, h)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  if (mips) anisotropic(gl)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}

export class GlobeGl {
  private hasField = false
  /** the satellite's cloud field, and the latitudes of its edges */
  private satTex: WebGLTexture | null = null
  private satLat: [number, number] | null = null
  /** the map drawn from (the other one is baked), the next strip to bake, and when the bake under way started */
  private front = 0
  private strip = 0
  private bakeTimeS = -Infinity
  private bakeDirty = true
  private baked = false
  /** NASA's Blue Marble of the whole world, and its shaded relief and bathymetry (the sea's colour) */
  private photoTex: WebGLTexture | null = null
  private bathyTex: WebGLTexture | null = null
  /** the land's cache (made when the first tile comes), the planning round that last said what the view wants, and the
   *  page table's clock; and the clouds' detail */
  private cache: Cache | null = null
  private keepStamp = 0
  private readonly bornAt = performance.now()
  private readonly texel = new Float32Array(2)
  private cloud: Sharp | null = null
  private cloudFadeAt = -Infinity
  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly prog: WebGLProgram,
    private readonly bake: WebGLProgram,
    private readonly loc: Record<"center" | "radius" | "view" | "sun" | "land" | "cmap" | "cmapPx" | "cloudOn" | "time" | "lightning" | "lod" | "photo" | "photoOn"
      | "atlas" | "page" | "atlasOn" | "nowS" | "bathy" | "bathyOn" | "dCloud" | "dCloudBox" | "dCloudPx" | "dCloudOn" | "satC" | "satCLat" | "satCOn", Uniform>,
    private readonly bakeLoc: Record<"field" | "fieldValidity" | "sat" | "satOn" | "satLat" | "time" | "size", Uniform>,
    private readonly landTex: WebGLTexture,
    /** a one-texel texture array, bound where the land's cache is not made yet */
    private readonly noArray: WebGLTexture,
    private readonly fieldTex: WebGLTexture,
    private readonly fieldValidityTex: WebGLTexture,
    private readonly maps: [WebGLTexture, WebGLTexture],
    private readonly fbo: WebGLFramebuffer,
    private readonly vao: WebGLVertexArrayObject,
    private readonly buf: WebGLBuffer,
    /** the cloud map's size */
    private readonly mapW: number,
    private readonly mapH: number,
  ) {}

  static create(canvas: HTMLCanvasElement): GlobeGl | null {
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" })
    if (!gl) return null
    const prog = link(gl, FRAG), bake = link(gl, BAKE_FRAG)
    if (!prog || !bake) return null
    // the larger maps where the GPU holds them (WebGL2 promises 2048)
    const big = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) >= CLOUD_MAP_W
    const mapW = big ? CLOUD_MAP_W : CLOUD_MAP_W / 2, mapH = big ? CLOUD_MAP_H : CLOUD_MAP_H / 2
    const vao = gl.createVertexArray(), buf = gl.createBuffer(), landTex = gl.createTexture(), fbo = gl.createFramebuffer()
    const fieldTex = texture(gl, FIELD_W, FIELD_H, false), fieldValidityTex = texture(gl, FIELD_W, FIELD_H, false)
    const mapA = texture(gl, mapW, mapH, true), mapB = texture(gl, mapW, mapH, true)
    const noArray = gl.createTexture()
    if (!vao || !buf || !landTex || !fbo || !fieldTex || !fieldValidityTex || !mapA || !mapB || !noArray) return null
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, noArray)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1)
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    gl.bindTexture(gl.TEXTURE_2D, landTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, big ? landMask() : halved(landMask()))
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    anisotropic(gl)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const at = (p: WebGLProgram) => (n: string) => gl.getUniformLocation(p, n)
    const u = at(prog), b = at(bake)
    return new GlobeGl(gl, prog, bake,
      { center: u("u_center"), radius: u("u_radius"), view: u("u_view"), sun: u("u_sun"), land: u("u_land"), cmap: u("u_cmap"), cmapPx: u("u_cmapPx"), cloudOn: u("u_cloudOn"), time: u("u_time"), lightning: u("u_lightning"), lod: u("u_lod"),
        photo: u("u_photo"), photoOn: u("u_photoOn"), atlas: u("u_atlas"), page: u("u_page"), atlasOn: u("u_atlasOn"), nowS: u("u_nowS"), bathy: u("u_bathy"), bathyOn: u("u_bathyOn"),
        dCloud: u("u_dCloud"), dCloudBox: u("u_dCloudBox"), dCloudPx: u("u_dCloudPx"), dCloudOn: u("u_dCloudOn"),
        satC: u("u_satC"), satCLat: u("u_satCLat"), satCOn: u("u_satCOn") },
      { field: b("u_field"), fieldValidity: b("u_fieldValidity"), sat: b("u_sat"), satOn: b("u_satOn"), satLat: b("u_satLat"), time: b("u_time"), size: b("u_size") },
      landTex, noArray, fieldTex, fieldValidityTex, [mapA, mapB], fbo, vao, buf, mapW, mapH)
  }

  /** The cloud field and evidence weights (cloudField.ts); null = no clouds known. A new bake starts on the next draw. */
  setClouds(field: CloudField | null): void {
    const gl = this.gl
    this.hasField = field != null
    if (!field) return
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FIELD_W, FIELD_H, gl.RGBA, gl.UNSIGNED_BYTE, field.data)
    gl.bindTexture(gl.TEXTURE_2D, this.fieldValidityTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FIELD_W, FIELD_H, gl.RGBA, gl.UNSIGNED_BYTE, field.validity)
    this.restartBake()
  }

  /** New data: the next bake starts from the first strip. */
  private restartBake(): void { this.bakeDirty = true; this.strip = 0 }

  /** a bake is waiting or under way for clouds there are: the globe should draw again soon (while it shows the clouds) */
  get busy(): boolean { return (this.hasField || this.satLat != null) && (this.bakeDirty || this.strip > 0) }

  /** The satellite's cloud field (satClouds.ts: w × h RGBA, the world in longitude from latTop down to latBottom); null
   *  = none, the model's clouds everywhere. A new bake starts on the next draw. */
  setSatellite(s: { field: Uint8Array; w: number; h: number; latTop: number; latBottom: number } | null): void {
    const gl = this.gl
    this.restartBake()
    if (!s) { this.satLat = null; return }
    if (!this.satTex) {
      this.satTex = gl.createTexture()
      if (!this.satTex) return
    }
    gl.bindTexture(gl.TEXTURE_2D, this.satTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, s.w, s.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, s.field)
    // its mip levels: the frame reads it blurred, to say where the clouds' fine structure may act
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.satLat = [s.latTop, s.latBottom]
  }

  /** NASA's Blue Marble of the whole world (equirectangular, north up), for the land's colours; halved for a GPU that
   *  holds no texture as large. */
  setPhoto(img: ImageBitmap): void {
    if (!this.photoTex) this.photoTex = this.gl.createTexture()
    if (this.photoTex) this.worldPicture(this.photoTex, img)
  }

  /** NASA's shaded relief and bathymetry of the whole world (equirectangular, north up), for the sea's colour. */
  setBathymetry(img: ImageBitmap): void {
    if (!this.bathyTex) this.bathyTex = this.gl.createTexture()
    if (this.bathyTex) this.worldPicture(this.bathyTex, img)
  }

  /** A picture of the whole world into a texture with its mip levels, halved for a GPU that holds no texture as large. */
  private worldPicture(tex: WebGLTexture, img: ImageBitmap): void {
    const gl = this.gl
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    let src: TexImageSource = img
    if (img.width > max) {
      const c = document.createElement("canvas")
      c.width = max
      c.height = Math.round((img.height * max) / img.width)
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height)
      src = c
    }
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    anisotropic(gl)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /** how many land tiles the cache holds on this GPU */
  get surfaceLayers(): number {
    const gl = this.gl
    const big = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) >= 8192
    return Math.min(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number, big ? CACHE_TILES_LARGE : CACHE_TILES)
  }

  /** Whether the cache holds a land tile. */
  hasSurfaceTile(z: number, row: number, col: number): boolean {
    return this.cache?.byKey.has(tileKey(z, row, col)) === true
  }

  /** What the view wants now: those of the tiles the cache holds stay; the others go first when room is needed. */
  keepSurfaceTiles(tiles: ReadonlyArray<{ z: number; row: number; col: number }>): void {
    const stamp = ++this.keepStamp, c = this.cache
    if (!c) return
    for (const t of tiles) {
      const layer = c.byKey.get(tileKey(t.z, t.row, t.col))
      const h = layer != null ? c.slots[layer] : null
      if (h) h.usedAt = stamp
    }
  }

  /** A land tile into the cache (it fades in), in a free layer or in place of the one the view wanted longest ago — never
   *  one it wants now (a tile it does not want, come in late, is the first to go again). False when there is no such
   *  room, or the picture is not a tile. */
  putSurfaceTile(z: number, row: number, col: number, img: ImageBitmap, wanted = true): boolean {
    const gl = this.gl, key = tileKey(z, row, col)
    if (img.width !== TILE_PX || img.height !== TILE_PX) return false
    const c = this.cache ?? this.makeCache()
    if (!c) return false
    if (c.byKey.has(key)) return true
    let layer = c.slots.indexOf(null)
    if (layer < 0) {
      let oldest = this.keepStamp
      c.slots.forEach((h, k) => { if (h && h.usedAt < oldest) { oldest = h.usedAt; layer = k } })
      if (layer < 0) return false
      const gone = c.slots[layer]!
      c.byKey.delete(gone.key)
      this.pageTexel(c, gone.z, gone.row, gone.col, 0, 0)
    }
    gl.activeTexture(gl.TEXTURE11)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, c.tex)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, TILE_PX, TILE_PX, 1, gl.RGBA, gl.UNSIGNED_BYTE, img)
    const now = performance.now()
    c.slots[layer] = { key, z, row, col, usedAt: wanted ? this.keepStamp : this.keepStamp - 1, at: now }
    c.byKey.set(key, layer)
    this.pageTexel(c, z, row, col, layer + 1, (now - this.bornAt) / 1000)
    return true
  }

  /** The cache, made on the first tile: a texture array of 512-px tiles and its page table (all empty). */
  private makeCache(): Cache | null {
    const gl = this.gl, layers = this.surfaceLayers
    const tex = gl.createTexture(), page = gl.createTexture()
    if (!tex || !page) return null
    gl.activeTexture(gl.TEXTURE11)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, TILE_PX, TILE_PX, layers)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.activeTexture(gl.TEXTURE10)
    gl.bindTexture(gl.TEXTURE_2D, page)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, PAGE_W, PAGE_H, 0, gl.RG, gl.FLOAT, new Float32Array(PAGE_W * PAGE_H * 2))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.cache = { tex, page, slots: new Array<Held | null>(layers).fill(null), byKey: new Map() }
    return this.cache
  }

  /** One entry of the page table: a tile's layer + 1 (0 = not held) and when it came in (s). */
  private pageTexel(c: Cache, z: number, row: number, col: number, layerPlus1: number, atS: number): void {
    const gl = this.gl
    this.texel[0] = layerPlus1
    this.texel[1] = atS
    gl.activeTexture(gl.TEXTURE10)
    gl.bindTexture(gl.TEXTURE_2D, c.page)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, col, pageRow(z, row), 1, 1, gl.RG, gl.FLOAT, this.texel)
  }

  /** The clouds in view (four bytes a texel: the infrared's fine structure and trust, the visible cloud and its trust —
   *  detailWorker.ts), or none. */
  setCloudDetail(d: { key: string; box: { west: number; south: number; east: number; north: number }; w: number; h: number; px: Uint8Array } | null): void {
    const gl = this.gl
    if (!d) {
      if (this.cloud) gl.deleteTexture(this.cloud.tex)
      this.cloud = null
      return
    }
    let tex = this.cloud && this.cloud.w === d.w && this.cloud.h === d.h ? this.cloud.tex : null
    if (!tex) {
      if (this.cloud) gl.deleteTexture(this.cloud.tex)
      else this.cloudFadeAt = performance.now()
      this.cloud = null
      tex = sharpTexture(gl, d.w, d.h, gl.RGBA8)
      if (!tex) return
    }
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, d.w, d.h, gl.RGBA, gl.UNSIGNED_BYTE, d.px)
    this.cloud = { key: d.key, tex, w: d.w, h: d.h, box: boxRad(d.box) }
  }

  /** the most tiles a side the clouds' detail may span on this GPU: 8 where it holds large textures (a desktop), 6 else */
  get maxSharpTiles(): number {
    const max = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number
    return Math.min(Math.floor(max / TILE_PX), max >= 8192 ? 8 : 6)
  }

  /** a land tile or the clouds' detail is fading in: the globe should draw again soon */
  get fading(): boolean {
    const now = performance.now()
    if (this.cloud != null && now - this.cloudFadeAt < FADE_MS) return true
    return this.cache != null && this.cache.slots.some((h) => h != null && now - h.at < TILE_FADE_MS)
  }

  draw(o: GlobeDraw): void {
    const gl = this.gl
    const cloudsOn = o.clouds && (this.hasField || this.satLat != null)
    if (cloudsOn) this.bakeStep(o.timeS, o.whole === true)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, o.width, o.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.prog)
    gl.uniform2f(this.loc.center, o.cx, o.height - o.cy)
    gl.uniform1f(this.loc.radius, o.r)
    gl.uniform2f(this.loc.view, o.view.lon * RAD, o.view.lat * RAD)
    gl.uniform3f(this.loc.sun, ...sunInView(o.sun, o.view))
    gl.uniform1f(this.loc.cloudOn, cloudsOn && this.baked ? 1 : 0)
    gl.uniform1f(this.loc.time, o.timeS)
    gl.uniform1f(this.loc.lightning, o.lightning ? 1 : 0)
    gl.uniform1f(this.loc.lod, Math.log2(this.mapW / (2 * Math.PI * Math.max(1, o.r))))
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.landTex)
    gl.uniform1i(this.loc.land, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.maps[this.front])
    gl.uniform1i(this.loc.cmap, 1)
    gl.uniform2f(this.loc.cmapPx, this.mapW, this.mapH)
    // the pictures; an absent one is stood in for by the land texture and switched off
    const now = performance.now(), fade = (at: number) => Math.min(1, Math.max(0, (now - at) / FADE_MS))
    gl.uniform1f(this.loc.photoOn, this.photoTex ? 1 : 0)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, this.photoTex ?? this.landTex)
    gl.uniform1i(this.loc.photo, 4)
    gl.uniform1f(this.loc.bathyOn, this.bathyTex ? 1 : 0)
    gl.activeTexture(gl.TEXTURE12)
    gl.bindTexture(gl.TEXTURE_2D, this.bathyTex ?? this.landTex)
    gl.uniform1i(this.loc.bathy, 12)
    // the land's cache, on units of its own
    const cache = this.photoTex ? this.cache : null
    gl.uniform1f(this.loc.atlasOn, cache && cache.byKey.size > 0 ? 1 : 0)
    gl.uniform1f(this.loc.nowS, (now - this.bornAt) / 1000)
    gl.activeTexture(gl.TEXTURE10)
    gl.bindTexture(gl.TEXTURE_2D, cache?.page ?? this.landTex)
    gl.uniform1i(this.loc.page, 10)
    gl.activeTexture(gl.TEXTURE11)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, cache?.tex ?? this.noArray)
    gl.uniform1i(this.loc.atlas, 11)
    const cloud = cloudsOn ? this.cloud : null
    gl.uniform1f(this.loc.dCloudOn, cloud ? fade(this.cloudFadeAt) : 0)
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, cloud?.tex ?? this.landTex)
    gl.uniform1i(this.loc.dCloud, 6)
    gl.uniform1f(this.loc.satCOn, this.satLat ? 1 : 0)
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, this.satLat ? this.satTex : this.landTex)
    gl.uniform1i(this.loc.satC, 7)
    gl.uniform2f(this.loc.satCLat, this.satLat?.[0] ?? 0, this.satLat?.[1] ?? 0)
    if (cloud) { gl.uniform4f(this.loc.dCloudBox, ...cloud.box); gl.uniform2f(this.loc.dCloudPx, cloud.w, cloud.h) }
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  /** One strip of the next cloud map (all of it when `whole`); the finished map takes over. */
  private bakeStep(timeS: number, whole: boolean): void {
    const gl = this.gl
    if (this.strip === 0) {
      if (!this.bakeDirty) return
      this.bakeTimeS = timeS
      this.bakeDirty = false
    }
    const back = this.maps[1 - this.front], rows = this.mapH / STRIPS
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, back, 0)
    gl.useProgram(this.bake)
    gl.uniform1f(this.bakeLoc.time, this.bakeTimeS)
    gl.uniform2f(this.bakeLoc.size, this.mapW, this.mapH)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex)
    gl.uniform1i(this.bakeLoc.field, 2)
    gl.activeTexture(gl.TEXTURE8)
    gl.bindTexture(gl.TEXTURE_2D, this.fieldValidityTex)
    gl.uniform1i(this.bakeLoc.fieldValidity, 8)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.satLat ? this.satTex : this.fieldTex)
    gl.uniform1i(this.bakeLoc.sat, 3)
    gl.uniform1f(this.bakeLoc.satOn, this.satLat ? 1 : 0)
    gl.uniform2f(this.bakeLoc.satLat, this.satLat?.[0] ?? 0, this.satLat?.[1] ?? 0)
    gl.bindVertexArray(this.vao)
    const count = whole ? STRIPS : 1
    for (let k = 0; k < count && this.strip < STRIPS; k++, this.strip++) {
      gl.viewport(0, this.strip * rows, this.mapW, rows)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (this.strip < STRIPS) return
    gl.bindTexture(gl.TEXTURE_2D, back)
    gl.generateMipmap(gl.TEXTURE_2D)
    this.front = 1 - this.front
    this.strip = 0
    this.baked = true
  }

  /** Frees the GPU objects. The context itself stays usable: the same canvas may be given to a new GlobeGl (a remount),
   *  and the browser frees the context with its canvas. */
  dispose(): void {
    const gl = this.gl
    gl.deleteTexture(this.landTex)
    gl.deleteTexture(this.fieldTex)
    gl.deleteTexture(this.fieldValidityTex)
    if (this.satTex) gl.deleteTexture(this.satTex)
    for (const t of [this.photoTex, this.bathyTex, this.cache?.tex, this.cache?.page, this.noArray, this.cloud?.tex]) if (t) gl.deleteTexture(t)
    for (const m of this.maps) gl.deleteTexture(m)
    gl.deleteFramebuffer(this.fbo)
    gl.deleteBuffer(this.buf)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.prog)
    gl.deleteProgram(this.bake)
  }
}
