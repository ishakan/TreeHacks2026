# 🔧 Bilateral Filter Guide

## What is the Bilateral Filter?

The bilateral filter is an **edge-preserving smoothing** filter. Unlike Gaussian blur which smooths everything uniformly, bilateral filtering:
- Smooths flat/uniform areas (reduces noise)
- **Preserves sharp edges** (doesn't blur boundaries)

This is ideal for furniture images where you want to reduce texture/noise while keeping clear furniture outlines.

## Parameters Explained

### 1. `d` (Diameter)
- **Range**: 1-25
- **What it does**: Defines the neighborhood size (how many nearby pixels to consider)
- **Effect**:
  - Small (1-5): Local smoothing only
  - Medium (7-15): Balanced smoothing
  - Large (15-25): Wide-area smoothing (slow!)

### 2. `sigmaColor`
- **Range**: 0.1-200
- **What it does**: Controls color similarity threshold
- **Effect**:
  - Small (0.1-10): Only nearly identical colors mix together → minimal smoothing
  - Medium (50-100): Similar colors mix → moderate smoothing
  - Large (150-200): Different colors mix → strong smoothing

### 3. `sigmaSpace`
- **Range**: 0.1-200
- **What it does**: Controls spatial distance weight
- **Effect**:
  - Small (0.1-10): Only center pixel matters → minimal smoothing
  - Medium (50-100): Nearby pixels influence each other → moderate smoothing
  - Large (150-200): Distant pixels influence each other → strong smoothing

## How to Nullify the Bilateral Filter

To make the bilateral filter have **no effect** (pass-through):

### Method 1: Minimum Sigma Values ⭐ Recommended
```bash
python visual_tuner.py furniture.jpeg \
  --bilateral-color 0.1 \
  --bilateral-space 0.1
```

**Why this works:**
- `sigmaColor = 0.1`: Only pixels with almost identical colors get mixed (essentially none)
- `sigmaSpace = 0.1`: Only the center pixel has meaningful weight
- Result: Each pixel remains unchanged

**Visual check:** Panels 2 and 3 should look identical

### Method 2: Minimum Diameter
```bash
python visual_tuner.py furniture.jpeg \
  --bilateral-d 1
```

**Why this works:**
- `d = 1`: Neighborhood contains only the pixel itself
- No neighbors = no blending = no effect

### Method 3: Use the Preset
```bash
python visual_tuner.py furniture.jpeg --preset no-bilateral
```

This preset sets:
- `bilateral_d = 1`
- `bilateral_color = 0.1`
- `bilateral_space = 0.1`

## Visual Comparison in the Tuner

When you nullify the bilateral filter, you should see:

```
Panel 2 (Gaussian Blur) ≈ Panel 3 (Bilateral Filter)
```

The bilateral filter output should look nearly identical to the Gaussian blur input, meaning it's not applying any additional filtering.

## When to Use/Skip Bilateral Filter

### ✅ Use Bilateral Filter When:
- Image has texture/grain you want to remove
- Furniture has fabric/upholstery with visible texture
- Photo has noise but you need sharp edges
- You want to smooth without losing detail

**Example:** Fabric sofa with visible weave pattern

### ❌ Skip Bilateral Filter When:
- Image is already clean (DSLR photo, good lighting)
- You want maximum sharpness and detail
- Processing speed is important (bilateral is slow)
- You already have enough smoothing from Gaussian blur

**Example:** Clean product photo on white background

## Comparing Gaussian vs Bilateral

### Gaussian Blur
- **Fast** computation
- **Uniform** smoothing everywhere
- **Blurs edges** along with noise
- Best for: General noise reduction

### Bilateral Filter
- **Slower** computation
- **Selective** smoothing (flat areas only)
- **Preserves edges**
- Best for: Noise reduction while keeping sharpness

### Both Together (Default Pipeline)
```
Input → Gaussian (fast noise reduction) → Bilateral (edge-preserving refinement) → Canny
```

This combination:
1. Gaussian quickly removes high-frequency noise
2. Bilateral refines smoothing while protecting edges
3. Result: Clean edges with less noise

## Testing Parameters Interactively

### Experiment 1: See Bilateral Effect
```bash
python visual_tuner.py furniture.jpeg
```

1. Set bilateral to default: `d=9, color=75, space=75`
2. **Compare Panel 2 vs Panel 3** - see the difference?
3. Move bilateral sliders - watch Panel 3 change

### Experiment 2: Nullify and Compare
```bash
python visual_tuner.py furniture.jpeg --preset no-bilateral
```

1. Panel 2 and Panel 3 should look almost identical
2. Now increase bilateral sliders - watch Panel 3 become smoother
3. This shows bilateral's effect clearly

### Experiment 3: Find Your Balance
```bash
python visual_tuner.py furniture.jpeg
```

1. Start with `bilateral-color = 0.1` (nullified)
2. Slowly increase it while watching Panel 3
3. Stop when flat areas smooth but edges stay sharp
4. Adjust `bilateral-d` and `bilateral-space` similarly

## Parameter Recipes

### Maximum Bilateral Effect
```
--bilateral-d 25 --bilateral-color 200 --bilateral-space 200
```
- Strong smoothing
- Edges still preserved (somewhat)
- Very slow

### Minimal Bilateral Effect (Near-Null)
```
--bilateral-d 1 --bilateral-color 0.1 --bilateral-space 0.1
```
- Almost no effect
- Panels 2 and 3 look identical
- Very fast

### Balanced Bilateral (Default)
```
--bilateral-d 9 --bilateral-color 75 --bilateral-space 75
```
- Moderate smoothing
- Good edge preservation
- Reasonable speed

### Edge-Focused Bilateral
```
--bilateral-d 7 --bilateral-color 50 --bilateral-space 50
```
- Light smoothing
- Maximum edge preservation
- Good for high-detail furniture

## Understanding the Visual Output

In the visual tuner, watch these panels:

### Panel 2 (Gaussian Blur)
- Shows: Image after basic noise reduction
- Purpose: Baseline for comparison

### Panel 3 (Bilateral Filter)
- Shows: Image after edge-preserving smoothing
- Purpose: Final pre-processed image before edge detection

### Compare 2 vs 3:
- **No visible difference?** → Bilateral is nullified or has minimal effect
- **Panel 3 smoother?** → Bilateral is working, smoothing flat areas
- **Panel 3 edges still sharp?** → Bilateral is preserving edges correctly
- **Panel 3 edges blurred?** → Bilateral parameters too high, reduce them

## Performance Notes

Bilateral filter is **computationally expensive**:

- `d=1`: Very fast (~instant)
- `d=5-9`: Fast (real-time on most machines)
- `d=15`: Moderate (noticeable lag)
- `d=25`: Slow (1-2 second delay)

For interactive tuning, if the UI feels sluggish:
1. Reduce `bilateral-d` to 5-9
2. Or nullify it: `--bilateral-d 1`
3. Adjust other parameters first
4. Enable bilateral later if needed

## Quick Reference

| To Achieve | Set Parameters |
|------------|----------------|
| **Nullify filter** | `d=1` OR `color=0.1, space=0.1` |
| **Minimal effect** | `d=5, color=25, space=25` |
| **Balanced** | `d=9, color=75, space=75` (default) |
| **Strong smoothing** | `d=15, color=150, space=150` |
| **Maximum effect** | `d=25, color=200, space=200` |

## Command Examples

```bash
# Nullified bilateral (Panel 2 ≈ Panel 3)
python visual_tuner.py furniture.jpeg --preset no-bilateral

# Weak bilateral
python visual_tuner.py furniture.jpeg \
  --bilateral-d 5 --bilateral-color 25 --bilateral-space 25

# Strong bilateral
python visual_tuner.py furniture.jpeg \
  --bilateral-d 15 --bilateral-color 150 --bilateral-space 150

# Compare with and without
python visual_tuner.py furniture.jpeg --bilateral-d 1  # Without
python visual_tuner.py furniture.jpeg --bilateral-d 15  # With
```

---

**Pro Tip**: Use the visual tuner's real-time preview to understand bilateral filtering! Move the sliders while watching Panel 3 to see exactly how it affects your image.
