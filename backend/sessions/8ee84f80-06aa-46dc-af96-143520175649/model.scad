// Parameters
seat_width = 40.0;
seat_depth = 40.0;
seat_thickness = 3.0;
seat_height = 45.0;
leg_top_size = 3.5;
leg_bottom_size = 2.5;
leg_height = 45.0;
back_post_top_size = 3.0;
back_post_bottom_size = 3.5;
back_post_height = 40.0;
back_angle = 5.0;
slat_width = 35.0;
slat_thickness = 1.5;
slat_depth = 2.0;
num_slats = 4.0;
slat_spacing = 8.0;
stretcher_size = 1.8;
stretcher_inset = 4.0;
stretcher_height_front = 15.0;
stretcher_height_side = 15.0;
$fn = 30;

// Model
module tapered_leg() {
    hull() {
        translate([0, 0, 0])
            cube([leg_bottom_size, leg_bottom_size, 0.1], center=true);
        translate([0, 0, leg_height])
            cube([leg_top_size, leg_top_size, 0.1], center=true);
    }
}

module back_post() {
    hull() {
        translate([0, 0, 0])
            cube([back_post_bottom_size, back_post_bottom_size, 0.1], center=true);
        translate([0, 0, back_post_height])
            cube([back_post_top_size, back_post_top_size, 0.1], center=true);
    }
}

union() {
    // Seat
    translate([0, 0, seat_height])
        cube([seat_width, seat_depth, seat_thickness], center=true);

    // Four legs
    leg_offset_x = seat_width/2 - leg_top_size/2 - 1;
    leg_offset_y = seat_depth/2 - leg_top_size/2 - 1;

    for (i = [0:3]) {
        x = (i % 2 == 0) ? -leg_offset_x : leg_offset_x;
        y = (i < 2) ? -leg_offset_y : leg_offset_y;
        translate([x, y, 0])
            tapered_leg();
    }

    // Back posts
    translate([0, 0, seat_height + seat_thickness])
        rotate([back_angle, 0, 0]) {
            for (x = [-1, 1]) {
                translate([x * (slat_width/2 - back_post_bottom_size/2), 0, 0])
                    back_post();
            }

            // Back slats
            for (i = [0:num_slats-1]) {
                slat_z = i * slat_spacing + 4;
                translate([0, 0, slat_z])
                    cube([slat_width, slat_depth, slat_thickness], center=true);
            }
        }

    // Front stretcher
    translate([0, -leg_offset_y, stretcher_height_front])
        cube([seat_width - 2*stretcher_inset, stretcher_size, stretcher_size], center=true);

    // Back stretcher
    translate([0, leg_offset_y, stretcher_height_front])
        cube([seat_width - 2*stretcher_inset, stretcher_size, stretcher_size], center=true);

    // Side stretchers
    for (x = [-1, 1]) {
        translate([x * leg_offset_x, 0, stretcher_height_side])
            cube([stretcher_size, seat_depth - 2*stretcher_inset, stretcher_size], center=true);
    }
}
