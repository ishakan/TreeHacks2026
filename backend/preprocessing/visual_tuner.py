import cv2 as cv
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider, Button
from matplotlib.gridspec import GridSpec
import os
from pathlib import Path


class VisualParameterTuner:
    """
    Interactive parameter tuning with matplotlib sliders
    """

    def __init__(self, image_path, initial_params=None):
        self.image_path = image_path
        self.original_image = cv.imread(image_path)
        if self.original_image is None:
            raise ValueError(f"Could not load image from {image_path}")

        # Convert BGR to RGB for matplotlib
        self.original_rgb = cv.cvtColor(self.original_image, cv.COLOR_BGR2RGB)

        # Initialize processed images
        self.gaussian_blurred = None
        self.bilateral_filtered = None
        self.edges = None
        self.contours = None
        self.svg_preview = None

        # Default parameters
        self.params = {
            'gauss_kernel': 5,
            'gauss_sigma': 1.0,
            'bilateral_d': 9,
            'bilateral_color': 75.0,
            'bilateral_space': 75.0,
            'canny_low': 50,
            'canny_high': 150,
            'canny_aperture': 3,
            'simplify_epsilon': 2.0
        }

        # Override with initial parameters if provided
        if initial_params:
            self.params.update(initial_params)

        # Setup the figure and widgets
        self.setup_figure()
        self.create_sliders()
        self.create_buttons()

        # Initial processing
        self.update(None)

    def setup_figure(self):
        """Setup the matplotlib figure with subplots"""
        self.fig = plt.figure(figsize=(20, 12))
        self.fig.suptitle(f'Interactive Parameter Tuner - {Path(self.image_path).name}',
                         fontsize=14, fontweight='bold')

        # Create grid layout - more rows for intermediate steps
        gs = GridSpec(4, 6, figure=self.fig,
                     left=0.05, right=0.95, top=0.93, bottom=0.28,
                     hspace=0.35, wspace=0.25)

        # Row 1: Original, Gaussian, Bilateral
        self.ax_original = self.fig.add_subplot(gs[0, 0:2])
        self.ax_gaussian = self.fig.add_subplot(gs[0, 2:4])
        self.ax_bilateral = self.fig.add_subplot(gs[0, 4:6])

        # Row 2: Canny Edges, SVG Preview, Overlay
        self.ax_edges = self.fig.add_subplot(gs[1, 0:2])
        self.ax_svg = self.fig.add_subplot(gs[1, 2:4])
        self.ax_overlay = self.fig.add_subplot(gs[1, 4:6])

        # Row 3: Statistics
        self.ax_stats = self.fig.add_subplot(gs[2, :])

        # Configure axes
        self.ax_original.set_title('1. Original Image', fontsize=10, fontweight='bold', color='#2c3e50')
        self.ax_original.axis('off')

        self.ax_gaussian.set_title('2. Gaussian Blur (Noise Reduction)', fontsize=10, fontweight='bold', color='#3498db')
        self.ax_gaussian.axis('off')

        self.ax_bilateral.set_title('3. Bilateral Filter (Edge-Preserving Smoothing)', fontsize=10, fontweight='bold', color='#3498db')
        self.ax_bilateral.axis('off')

        self.ax_edges.set_title('4. Canny Edge Detection', fontsize=10, fontweight='bold', color='#e74c3c')
        self.ax_edges.axis('off')

        self.ax_svg.set_title('5. SVG Preview (Final Output)', fontsize=10, fontweight='bold', color='#27ae60')
        self.ax_svg.axis('off')

        self.ax_overlay.set_title('6. Overlay on Original', fontsize=10, fontweight='bold', color='#8e44ad')
        self.ax_overlay.axis('off')

        self.ax_stats.axis('off')

        # Initialize image displays
        self.img_original = self.ax_original.imshow(self.original_rgb)
        self.img_gaussian = self.ax_gaussian.imshow(self.original_rgb)
        self.img_bilateral = self.ax_bilateral.imshow(self.original_rgb)
        self.img_edges = self.ax_edges.imshow(np.zeros_like(self.original_rgb[:,:,0]), cmap='gray')
        self.img_svg = self.ax_svg.imshow(np.ones_like(self.original_rgb) * 255)
        self.img_overlay = self.ax_overlay.imshow(self.original_rgb)

    def create_sliders(self):
        """Create all parameter sliders"""
        slider_color = '#3498db'

        # Slider layout parameters
        left_margin = 0.12
        slider_width = 0.35
        slider_height = 0.02
        vertical_gap = 0.025

        # Column 1: Gaussian Blur
        col1_x = left_margin
        start_y = 0.22

        # Map initial values to slider positions
        kernel_map = {3: 1, 5: 2, 7: 3, 9: 4, 11: 5}
        aperture_map = {3: 0, 5: 1, 7: 2}

        # Gaussian Kernel slider (discrete values: 3, 5, 7, 9, 11)
        ax_gauss_k = plt.axes([col1_x, start_y, slider_width, slider_height])
        self.slider_gauss_k = Slider(
            ax_gauss_k, 'Gauss Kernel', 1, 5,
            valinit=kernel_map.get(self.params['gauss_kernel'], 2),
            valstep=1, color=slider_color
        )
        self.slider_gauss_k.label.set_size(9)
        self.slider_gauss_k.valtext.set_text(str(self.params['gauss_kernel']))

        # Gaussian Sigma
        ax_gauss_s = plt.axes([col1_x, start_y - vertical_gap, slider_width, slider_height])
        self.slider_gauss_s = Slider(
            ax_gauss_s, 'Gauss Sigma', 0.1, 5.0,
            valinit=self.params['gauss_sigma'], color=slider_color
        )
        self.slider_gauss_s.label.set_size(9)

        # Bilateral Diameter
        ax_bilat_d = plt.axes([col1_x, start_y - 2*vertical_gap, slider_width, slider_height])
        self.slider_bilat_d = Slider(
            ax_bilat_d, 'Bilateral D', 1, 25,
            valinit=self.params['bilateral_d'], valstep=2, color=slider_color
        )
        self.slider_bilat_d.label.set_size(9)

        # Bilateral Color
        ax_bilat_c = plt.axes([col1_x, start_y - 3*vertical_gap, slider_width, slider_height])
        self.slider_bilat_c = Slider(
            ax_bilat_c, 'Bilateral Color', 0.1, 200,
            valinit=self.params['bilateral_color'], color=slider_color
        )
        self.slider_bilat_c.label.set_size(9)

        # Bilateral Space
        ax_bilat_s = plt.axes([col1_x, start_y - 4*vertical_gap, slider_width, slider_height])
        self.slider_bilat_s = Slider(
            ax_bilat_s, 'Bilateral Space', 0.1, 200,
            valinit=self.params['bilateral_space'], color=slider_color
        )
        self.slider_bilat_s.label.set_size(9)

        # Column 2: Canny Edge
        col2_x = left_margin + slider_width + 0.08

        # Canny Low Threshold
        ax_canny_l = plt.axes([col2_x, start_y, slider_width, slider_height])
        self.slider_canny_l = Slider(
            ax_canny_l, 'Canny Low', 1, 200,
            valinit=self.params['canny_low'], color='#e74c3c'
        )
        self.slider_canny_l.label.set_size(9)

        # Canny High Threshold
        ax_canny_h = plt.axes([col2_x, start_y - vertical_gap, slider_width, slider_height])
        self.slider_canny_h = Slider(
            ax_canny_h, 'Canny High', 1, 300,
            valinit=self.params['canny_high'], color='#e74c3c'
        )
        self.slider_canny_h.label.set_size(9)

        # Canny Aperture (discrete: 3, 5, 7)
        ax_canny_a = plt.axes([col2_x, start_y - 2*vertical_gap, slider_width, slider_height])
        self.slider_canny_a = Slider(
            ax_canny_a, 'Canny Aperture', 0, 2,
            valinit=aperture_map.get(self.params['canny_aperture'], 0),
            valstep=1, color='#e74c3c'
        )
        self.slider_canny_a.label.set_size(9)
        self.slider_canny_a.valtext.set_text(str(self.params['canny_aperture']))

        # Simplification Epsilon
        ax_simplify = plt.axes([col2_x, start_y - 3*vertical_gap, slider_width, slider_height])
        self.slider_simplify = Slider(
            ax_simplify, 'Simplify ε', 0.1, 10.0,
            valinit=self.params['simplify_epsilon'], color='#2ecc71'
        )
        self.slider_simplify.label.set_size(9)

        # Connect sliders to update function
        self.slider_gauss_k.on_changed(self.update)
        self.slider_gauss_s.on_changed(self.update)
        self.slider_bilat_d.on_changed(self.update)
        self.slider_bilat_c.on_changed(self.update)
        self.slider_bilat_s.on_changed(self.update)
        self.slider_canny_l.on_changed(self.update)
        self.slider_canny_h.on_changed(self.update)
        self.slider_canny_a.on_changed(self.update)
        self.slider_simplify.on_changed(self.update)

    def create_buttons(self):
        """Create control buttons"""
        # Save SVG button
        ax_save = plt.axes([0.42, 0.02, 0.15, 0.04])
        self.btn_save = Button(ax_save, 'Save SVG', color='#27ae60', hovercolor='#2ecc71')
        self.btn_save.on_clicked(self.save_svg)

        # Reset button
        ax_reset = plt.axes([0.59, 0.02, 0.15, 0.04])
        self.btn_reset = Button(ax_reset, 'Reset Parameters', color='#e67e22', hovercolor='#f39c12')
        self.btn_reset.on_clicked(self.reset_params)

        # Export edges button
        ax_export = plt.axes([0.76, 0.02, 0.15, 0.04])
        self.btn_export = Button(ax_export, 'Export Edges', color='#8e44ad', hovercolor='#9b59b6')
        self.btn_export.on_clicked(self.export_edges)

    def get_current_params(self):
        """Get current parameter values from sliders"""
        # Map discrete slider values
        kernel_map = {1: 3, 2: 5, 3: 7, 4: 9, 5: 11}
        aperture_map = {0: 3, 1: 5, 2: 7}

        self.params['gauss_kernel'] = kernel_map[int(self.slider_gauss_k.val)]
        self.params['gauss_sigma'] = self.slider_gauss_s.val
        self.params['bilateral_d'] = int(self.slider_bilat_d.val)
        self.params['bilateral_color'] = self.slider_bilat_c.val
        self.params['bilateral_space'] = self.slider_bilat_s.val
        self.params['canny_low'] = int(self.slider_canny_l.val)
        self.params['canny_high'] = int(self.slider_canny_h.val)
        self.params['canny_aperture'] = aperture_map[int(self.slider_canny_a.val)]
        self.params['simplify_epsilon'] = self.slider_simplify.val

        # Update discrete slider text displays
        self.slider_gauss_k.valtext.set_text(str(self.params['gauss_kernel']))
        self.slider_canny_a.valtext.set_text(str(self.params['canny_aperture']))

    def process_image(self):
        """Process image with current parameters"""
        p = self.params

        # Step 1: Gaussian Blur
        blurred = cv.GaussianBlur(
            self.original_image,
            (p['gauss_kernel'], p['gauss_kernel']),
            p['gauss_sigma']
        )
        self.gaussian_blurred = blurred

        # Step 2: Bilateral Filter
        filtered = cv.bilateralFilter(
            blurred,
            p['bilateral_d'],
            p['bilateral_color'],
            p['bilateral_space']
        )
        self.bilateral_filtered = filtered

        # Step 3: Convert to grayscale
        gray = cv.cvtColor(filtered, cv.COLOR_BGR2GRAY)

        # Step 4: Canny Edge Detection
        edges = cv.Canny(
            gray,
            p['canny_low'],
            p['canny_high'],
            apertureSize=p['canny_aperture']
        )
        self.edges = edges

        # Step 5: Find contours
        contours, _ = cv.findContours(edges, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)
        self.contours = contours

        # Step 6: Generate SVG preview
        self.generate_svg_preview()

    def generate_svg_preview(self):
        """Generate a preview of what the SVG will look like"""
        height, width = self.edges.shape

        # Create white canvas
        svg_preview = np.ones((height, width, 3), dtype=np.uint8) * 255

        # Create overlay (original image with contours)
        overlay = self.original_rgb.copy()

        epsilon = self.params['simplify_epsilon']

        # Draw simplified contours
        for contour in self.contours:
            if len(contour) < 3:
                continue

            # Simplify contour
            approx = cv.approxPolyDP(contour, epsilon, True)

            if len(approx) < 2:
                continue

            # Draw on SVG preview (black lines on white)
            cv.drawContours(svg_preview, [approx], -1, (0, 0, 0), 1, cv.LINE_AA)

            # Draw on overlay (colored lines on original)
            cv.drawContours(overlay, [approx], -1, (255, 0, 0), 2, cv.LINE_AA)

        self.svg_preview = cv.cvtColor(svg_preview, cv.COLOR_BGR2RGB)
        self.overlay_preview = overlay

    def update(self, val):
        """Update visualization when sliders change"""
        # Get current parameters
        self.get_current_params()

        # Process image
        self.process_image()

        # Update all displays
        # Convert BGR to RGB for matplotlib
        gaussian_rgb = cv.cvtColor(self.gaussian_blurred, cv.COLOR_BGR2RGB)
        bilateral_rgb = cv.cvtColor(self.bilateral_filtered, cv.COLOR_BGR2RGB)

        self.img_gaussian.set_data(gaussian_rgb)
        self.img_bilateral.set_data(bilateral_rgb)
        self.img_edges.set_data(self.edges)
        self.img_svg.set_data(self.svg_preview)
        self.img_overlay.set_data(self.overlay_preview)

        # Update statistics
        self.update_statistics()

        # Redraw
        self.fig.canvas.draw_idle()

    def update_statistics(self):
        """Update statistics text"""
        self.ax_stats.clear()
        self.ax_stats.axis('off')

        # Calculate statistics
        edge_pixels = np.count_nonzero(self.edges)
        total_pixels = self.edges.shape[0] * self.edges.shape[1]
        edge_percentage = (edge_pixels / total_pixels) * 100
        num_contours = len(self.contours)

        # Calculate simplified contour points
        epsilon = self.params['simplify_epsilon']
        simplified_points = 0
        original_points = 0
        for contour in self.contours:
            if len(contour) >= 3:
                approx = cv.approxPolyDP(contour, epsilon, True)
                simplified_points += len(approx)
                original_points += len(contour)

        # Estimate SVG file size (rough approximation)
        estimated_svg_kb = (simplified_points * 12 + 500) / 1024  # rough estimate

        # Quality indicator
        if edge_percentage < 3:
            quality_indicator = "⚠️  Very low edge density - may be missing details"
        elif edge_percentage < 5:
            quality_indicator = "⚡ Low edge density"
        elif edge_percentage <= 15:
            quality_indicator = "✓ Good edge density"
        elif edge_percentage <= 25:
            quality_indicator = "⚠️  High edge density - may be noisy"
        else:
            quality_indicator = "❌ Very high edge density - too noisy"

        # Create statistics text
        stats_text = f"""
PROCESSING STATISTICS:
  • Edge Pixels: {edge_pixels:,} / {total_pixels:,} ({edge_percentage:.2f}%) {quality_indicator}
  • Contours Detected: {num_contours:,}
  • Contour Points: {original_points:,} → {simplified_points:,} (after simplification, {100*(1-simplified_points/max(original_points,1)):.1f}% reduction)
  • Estimated SVG Size: ~{estimated_svg_kb:.1f} KB

CURRENT PARAMETERS:
  Step 1 (Gaussian Blur): kernel={self.params['gauss_kernel']}, σ={self.params['gauss_sigma']:.2f}
  Step 2 (Bilateral Filter): d={self.params['bilateral_d']}, σ_color={self.params['bilateral_color']:.1f}, σ_space={self.params['bilateral_space']:.1f}
  Step 3 (Canny Edge): low={self.params['canny_low']}, high={self.params['canny_high']}, aperture={self.params['canny_aperture']}
  Step 4 (SVG Simplification): ε={self.params['simplify_epsilon']:.2f}
        """

        self.ax_stats.text(0.02, 0.5, stats_text.strip(),
                          fontsize=8.5, family='monospace',
                          verticalalignment='center',
                          bbox=dict(boxstyle='round', facecolor='lightblue', alpha=0.3))

    def edges_to_svg(self, output_path):
        """Convert edges to SVG"""
        contours, hierarchy = cv.findContours(
            self.edges, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE
        )

        height, width = self.edges.shape

        # Start SVG file
        svg_content = f'<?xml version="1.0" encoding="UTF-8"?>\n'
        svg_content += f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">\n'
        svg_content += f'  <rect width="{width}" height="{height}" fill="white"/>\n'

        # Convert each contour to a path
        epsilon = self.params['simplify_epsilon']
        for contour in contours:
            if len(contour) < 3:
                continue

            # Simplify contour
            approx = cv.approxPolyDP(contour, epsilon, True)

            if len(approx) < 2:
                continue

            # Build path string
            path_data = f"M {approx[0][0][0]},{approx[0][0][1]}"
            for point in approx[1:]:
                path_data += f" L {point[0][0]},{point[0][1]}"
            path_data += " Z"

            # Add path to SVG
            svg_content += f'  <path d="{path_data}" fill="none" stroke="black" stroke-width="1"/>\n'

        svg_content += '</svg>'

        # Write to file
        with open(output_path, 'w') as f:
            f.write(svg_content)

        return output_path

    def save_svg(self, event):
        """Save current result as SVG"""
        base_name = Path(self.image_path).stem
        output_path = f"{base_name}_tuned.svg"

        self.edges_to_svg(output_path)
        print(f"\n✓ SVG saved to: {output_path}")

        # Show confirmation in plot
        self.fig.suptitle(f'✓ SVG Saved: {output_path}',
                         fontsize=14, fontweight='bold', color='green')
        self.fig.canvas.draw_idle()

        # Reset title after 2 seconds
        self.fig.canvas.mpl_connect('timer_event',
                                     lambda x: self.reset_title())
        timer = self.fig.canvas.new_timer(interval=2000)
        timer.single_shot = True
        timer.add_callback(self.reset_title)
        timer.start()

    def export_edges(self, event):
        """Export edge detection result as image"""
        base_name = Path(self.image_path).stem
        output_path = f"{base_name}_edges.jpg"

        cv.imwrite(output_path, self.edges)
        print(f"\n✓ Edges saved to: {output_path}")

        self.fig.suptitle(f'✓ Edges Saved: {output_path}',
                         fontsize=14, fontweight='bold', color='blue')
        self.fig.canvas.draw_idle()

        timer = self.fig.canvas.new_timer(interval=2000)
        timer.single_shot = True
        timer.add_callback(self.reset_title)
        timer.start()

    def reset_title(self):
        """Reset figure title"""
        self.fig.suptitle(f'Interactive Parameter Tuner - {Path(self.image_path).name}',
                         fontsize=14, fontweight='bold', color='black')
        self.fig.canvas.draw_idle()

    def reset_params(self, event):
        """Reset all parameters to defaults"""
        self.slider_gauss_k.set_val(2)  # maps to 5
        self.slider_gauss_s.set_val(1.0)
        self.slider_bilat_d.set_val(9)
        self.slider_bilat_c.set_val(75)
        self.slider_bilat_s.set_val(75)
        self.slider_canny_l.set_val(50)
        self.slider_canny_h.set_val(150)
        self.slider_canny_a.set_val(0)  # maps to 3
        self.slider_simplify.set_val(2.0)

        print("\n✓ Parameters reset to defaults")

    def show(self):
        """Display the interactive tuner"""
        plt.show()


def main():
    import sys
    import argparse

    parser = argparse.ArgumentParser(
        description='Visual Parameter Tuner with interactive sliders',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic usage
  python visual_tuner.py furniture.jpeg

  # Start with custom parameters
  python visual_tuner.py furniture.jpeg --gauss-kernel 7 --canny-low 30 --canny-high 100

  # Use a preset configuration
  python visual_tuner.py furniture.jpeg --preset high-detail
        """
    )

    parser.add_argument('image', nargs='?', default='furniture.jpeg',
                       help='Input image path (default: furniture.jpeg)')

    # Parameter initialization
    parser.add_argument('--gauss-kernel', type=int, choices=[3, 5, 7, 9, 11],
                       help='Initial Gaussian kernel size')
    parser.add_argument('--gauss-sigma', type=float,
                       help='Initial Gaussian sigma')
    parser.add_argument('--bilateral-d', type=int,
                       help='Initial bilateral filter diameter')
    parser.add_argument('--bilateral-color', type=float,
                       help='Initial bilateral color sigma')
    parser.add_argument('--bilateral-space', type=float,
                       help='Initial bilateral space sigma')
    parser.add_argument('--canny-low', type=int,
                       help='Initial Canny low threshold')
    parser.add_argument('--canny-high', type=int,
                       help='Initial Canny high threshold')
    parser.add_argument('--canny-aperture', type=int, choices=[3, 5, 7],
                       help='Initial Canny aperture size')
    parser.add_argument('--simplify', type=float,
                       help='Initial simplification epsilon')

    # Preset configurations
    parser.add_argument('--preset', choices=['default', 'high-detail', 'simple', 'noisy', 'minimal', 'no-bilateral'],
                       help='Use a preset parameter configuration')

    args = parser.parse_args()

    image_path = args.image
    if not os.path.exists(image_path):
        print(f"✗ Error: Image file not found: {image_path}")
        print("\nUsage: python visual_tuner.py <image_path> [options]")
        print("\nExample: python visual_tuner.py furniture.jpeg")
        return

    print("="*60)
    print("VISUAL PARAMETER TUNER")
    print("="*60)
    print(f"\nLoading image: {image_path}")

    # Define presets
    presets = {
        'default': {
            'gauss_kernel': 5, 'gauss_sigma': 1.0,
            'bilateral_d': 9, 'bilateral_color': 75.0, 'bilateral_space': 75.0,
            'canny_low': 50, 'canny_high': 150, 'canny_aperture': 3,
            'simplify_epsilon': 2.0
        },
        'high-detail': {
            'gauss_kernel': 3, 'gauss_sigma': 0.8,
            'bilateral_d': 7, 'bilateral_color': 60.0, 'bilateral_space': 60.0,
            'canny_low': 25, 'canny_high': 80, 'canny_aperture': 3,
            'simplify_epsilon': 1.5
        },
        'simple': {
            'gauss_kernel': 7, 'gauss_sigma': 2.0,
            'bilateral_d': 15, 'bilateral_color': 100.0, 'bilateral_space': 100.0,
            'canny_low': 50, 'canny_high': 150, 'canny_aperture': 3,
            'simplify_epsilon': 3.0
        },
        'noisy': {
            'gauss_kernel': 9, 'gauss_sigma': 3.0,
            'bilateral_d': 20, 'bilateral_color': 150.0, 'bilateral_space': 150.0,
            'canny_low': 60, 'canny_high': 180, 'canny_aperture': 3,
            'simplify_epsilon': 4.0
        },
        'minimal': {
            'gauss_kernel': 11, 'gauss_sigma': 4.0,
            'bilateral_d': 25, 'bilateral_color': 200.0, 'bilateral_space': 200.0,
            'canny_low': 100, 'canny_high': 250, 'canny_aperture': 3,
            'simplify_epsilon': 6.0
        },
        'no-bilateral': {
            'gauss_kernel': 5, 'gauss_sigma': 1.0,
            'bilateral_d': 1, 'bilateral_color': 0.1, 'bilateral_space': 0.1,
            'canny_low': 50, 'canny_high': 150, 'canny_aperture': 3,
            'simplify_epsilon': 2.0
        }
    }

    # Get initial parameters
    if args.preset:
        initial_params = presets[args.preset]
        print(f"Using preset: {args.preset}")
    else:
        initial_params = presets['default'].copy()

    # Override with command-line arguments
    if args.gauss_kernel is not None:
        initial_params['gauss_kernel'] = args.gauss_kernel
    if args.gauss_sigma is not None:
        initial_params['gauss_sigma'] = args.gauss_sigma
    if args.bilateral_d is not None:
        initial_params['bilateral_d'] = args.bilateral_d
    if args.bilateral_color is not None:
        initial_params['bilateral_color'] = args.bilateral_color
    if args.bilateral_space is not None:
        initial_params['bilateral_space'] = args.bilateral_space
    if args.canny_low is not None:
        initial_params['canny_low'] = args.canny_low
    if args.canny_high is not None:
        initial_params['canny_high'] = args.canny_high
    if args.canny_aperture is not None:
        initial_params['canny_aperture'] = args.canny_aperture
    if args.simplify is not None:
        initial_params['simplify_epsilon'] = args.simplify

    print("\nInitial Parameters:")
    for key, value in initial_params.items():
        print(f"  {key}: {value}")

    print("\nInstructions:")
    print("  • Use sliders to adjust parameters in real-time")
    print("  • Watch edge detection update automatically")
    print("  • Click 'Save SVG' when satisfied with results")
    print("  • Click 'Reset Parameters' to restore defaults")
    print("  • Click 'Export Edges' to save edge image")
    print("\nTips:")
    print("  • Lower Canny thresholds = more edges")
    print("  • Higher Gaussian blur = smoother result")
    print("  • Higher simplify ε = smaller SVG file")
    print("="*60)

    try:
        tuner = VisualParameterTuner(image_path, initial_params=initial_params)
        tuner.show()
    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
