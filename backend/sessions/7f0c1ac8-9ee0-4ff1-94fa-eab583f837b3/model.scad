// Parameters
seat_width = 30.0;
seat_depth = 16.0;
seat_thickness = 1.2;
seat_height = 18.0;
leg_top_radius = 5.0;
leg_bottom_radius = 0.6;
back_post_height = 18.0;
back_angle = 12.0;
back_slat_count = 4.0;
back_slat_width = 14.0;
back_slat_thickness = 0.6;
back_slat_height = 1.2;
stretcher_radius = 0.4;
stretcher_position = 0.35; // fraction of leg height

$fn = 64;

// Modules
module tapered_leg(height, top_r, bottom_r) {
    cylinder(h=height, r1=top_r, r2=bottom_r);
}

module rounded_seat() {
    minkowski() {
        cube([seat_width - 1, seat_depth - 1, seat_thickness - 0.5], center=true);
        sphere(r=0.5);
    }
}

module back_slat() {
    minkowski() {
        cube([back_slat_width - 0.4, back_slat_thickness - 0.4, back_slat_height - 0.4], center=true);
        sphere(r=0.2);
    }
}

module stretcher(length) {
    rotate([0, 90, 0])
        cylinder(h=length, r=stretcher_radius, center=true);
}

// Main Model
union() {
    // Front left leg
    translate([-(seat_width/2 - leg_top_radius - 1), -(seat_depth/2 - leg_top_radius - 1), 0])
        tapered_leg(seat_height, leg_top_radius, leg_bottom_radius);

    // Front right leg
    translate([seat_width/2 - leg_top_radius - 1, -(seat_depth/2 - leg_top_radius - 1), 0])
        tapered_leg(seat_height, leg_top_radius, leg_bottom_radius);

    // Back left leg with extended post
    translate([-(seat_width/2 - leg_top_radius - 1), seat_depth/2 - leg_top_radius - 1, 0])
        rotate([back_angle, 0, 0])
            tapered_leg(seat_height + back_post_height, leg_top_radius, leg_bottom_radius);

    // Back right leg with extended post
    translate([seat_width/2 - leg_top_radius - 1, seat_depth/2 - leg_top_radius - 1, 0])
        rotate([back_angle, 0, 0])
            tapered_leg(seat_height + back_post_height, leg_top_radius, leg_bottom_radius);

    // Seat
    translate([0, 0, seat_height])
        rounded_seat();

    // Front stretcher
    translate([0, -(seat_depth/2 - leg_top_radius - 1), seat_height * stretcher_position])
        stretcher(seat_width - 2 * (leg_top_radius + 1));

    // Left stretcher
    translate([-(seat_width/2 - leg_top_radius - 1), 0, seat_height * stretcher_position])
        rotate([0, 0, 90])
            stretcher(seat_depth - 2 * (leg_top_radius + 1));

    // Right stretcher
    translate([seat_width/2 - leg_top_radius - 1, 0, seat_height * stretcher_position])
        rotate([0, 0, 90])
            stretcher(seat_depth - 2 * (leg_top_radius + 1));

    // Back stretcher
    translate([0, seat_depth/2 - leg_top_radius - 1, seat_height * stretcher_position])
        rotate([back_angle, 0, 0])
            stretcher(seat_width - 2 * (leg_top_radius + 1));

    // Back slats
    for (i = [0 : back_slat_count - 1]) {
        translate([
            0,
            (seat_depth/2 - leg_top_radius - 1) + sin(back_angle) * (seat_height + 3 + i * (back_post_height - 6) / (back_slat_count - 1)),
            seat_height + 3 + i * (back_post_height - 6) / (back_slat_count - 1) - cos(back_angle) * sin(back_angle) * (seat_height + 3 + i * (back_post_height - 6) / (back_slat_count - 1))
        ])
        rotate([back_angle, 0, 0])
            back_slat();
    }
}
