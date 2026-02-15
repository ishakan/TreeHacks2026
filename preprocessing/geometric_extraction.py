import cv2 as cv
import numpy as np
from scipy.interpolate import splprep, splev

def transform_perspective(mask):
    
    
    return img


def smooth_contour(points, smoothing=0.2):
    n = len(points)

    def control_points(p0, p1, p2):
        d01 = np.linalg.norm(p1 - p0)
        d12 = np.linalg.norm(p2 - p1)
        tangent = (p2 - p0) / (d01 + d12 + 1e-8)
        cp_in  = p1 - tangent * d01 * smoothing
        cp_out = p1 + tangent * d12 * smoothing
        return cp_in, cp_out

    cps = []
    for i in range(n):
        p0 = points[(i - 1) % n]
        p1 = points[i]
        p2 = points[(i + 1) % n]
        cps.append(control_points(p0, p1, p2))

    d = f"M {points[0][0]:.2f} {points[0][1]:.2f} "
    for i in range(n):
        next_i = (i + 1) % n
        cp1 = cps[i][1]
        cp2 = cps[next_i][0]
        p   = points[next_i]
        d += f"C {cp1[0]:.2f} {cp1[1]:.2f} {cp2[0]:.2f} {cp2[1]:.2f} {p[0]:.2f} {p[1]:.2f} "

    return d + "Z"
    
def extract_contours(img, min_perimeter = 0, min_area = 0):
    h, w = img.shape[:2]
    gray = cv.cvtColor(img, cv.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    filtered = cv.bilateralFilter(img, d=9, sigmaColor=75, sigmaSpace=75)
    edges = cv.Canny(filtered, 50, 150)
    contours, _ = cv.findContours(edges, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    clean_contours = []
    for contour in contours:
        # drop noisy small contours
        if cv.contourArea(contour) < min_area:
            continue
        # simplify staircase points
        epsilon = 0.002 * cv.arcLength(contour, True)
        simplified = cv.approxPolyDP(contour, epsilon, True)
        if len(simplified) >= 4:  # spline needs at least 4 points
            clean_contours.append(simplified)

    paths = ""
    for contour in clean_contours:
        points = contour.reshape(-1, 2).astype(float)

        try:
            # per=True treats the contour as a closed loop
            tck, u = splprep([points[:, 0], points[:, 1]], s=5, per=True)
            new_u = np.linspace(0, 1, 200)
            smooth_x, smooth_y = splev(new_u, tck)
        except Exception:
            # fall back to original points if spline fitting fails
            smooth_x, smooth_y = points[:, 0], points[:, 1]

        # build SVG path from smoothed points using cubic bezier
        smooth_points = np.stack([smooth_x, smooth_y], axis=1)
        d = smooth_contour(smooth_points)
        paths += f'  <path d="{d}" fill="none" stroke="black" stroke-width="1"/>\n'
    return paths