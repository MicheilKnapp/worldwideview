import { useEffect } from "react";
import type { Viewer as CesiumViewer } from "cesium";
import {
 Cartesian3, EasingFunction, Ellipsoid, Math as CesiumMath, Transforms, Matrix4, Rectangle
} from "cesium";
import { dataBus } from "@/core/data/DataBus";
import { showSearchPin } from "./searchPinAnimation";

export function useCameraActions(viewer: CesiumViewer | null, isReady: boolean) {
    useEffect(() => {
        if (!viewer || !isReady) return;

        const unsubFace = dataBus.on("cameraFaceTowards", ({ lat, lon, alt }) => {
            if (!viewer || viewer.isDestroyed()) return;
            console.log("[GlobeView] Native faceTowards", lat, lon, alt);
            const target = Cartesian3.fromDegrees(lon, lat, alt);
            const offset = Cartesian3.subtract(
                viewer.camera.positionWC,
                target,
                new Cartesian3()
            );
            // lookAt sets the view relative to the target's ENU frame
            viewer.camera.lookAt(target, offset);
            // Immediately release the transform to allow free camera movement again
            // while preserving the orientation
            viewer.camera.lookAtTransform(Matrix4.IDENTITY);
        });

        const unsubGoTo = dataBus.on("cameraGoTo", ({
 lat, lon, alt, distance, maxPitch, heading
}) => {
            // Add a slight delay to avoid any immediate state-change cancellations from React
            setTimeout(() => {
                if (!viewer || viewer.isDestroyed()) return;
                const targetPosition = Cartesian3.fromDegrees(lon, lat, alt || 0);
                const cameraPosition = viewer.camera.positionWC;

                // Calculate direction from camera to the target object
                const direction = Cartesian3.subtract(targetPosition, cameraPosition, new Cartesian3());
                Cartesian3.normalize(direction, direction);

                // Enforce maximum pitch (default -30 degrees)
                const targetLocalUp = Ellipsoid.WGS84.geodeticSurfaceNormal(targetPosition, new Cartesian3());
                const pitchDot = Cartesian3.dot(direction, targetLocalUp);
                let pitch = Math.asin(pitchDot);
                const maxPitchRad = CesiumMath.toRadians(maxPitch !== undefined ? maxPitch : -30);

                if (pitch > maxPitchRad) {
                    pitch = maxPitchRad;
                    // Extract the horizontal component of the direction to reconstruct it
                    const vertComponent = Cartesian3.multiplyByScalar(targetLocalUp, pitchDot, new Cartesian3());
                    const horiz = Cartesian3.subtract(direction, vertComponent, new Cartesian3());

                    if (Cartesian3.magnitude(horiz) > 0.0001) {
                        Cartesian3.normalize(horiz, horiz);
                        const cosP = Math.cos(pitch);
                        const sinP = Math.sin(pitch);
                        const newHoriz = Cartesian3.multiplyByScalar(horiz, cosP, new Cartesian3());
                        const newVert = Cartesian3.multiplyByScalar(targetLocalUp, sinP, new Cartesian3());
                        Cartesian3.add(newHoriz, newVert, direction);
                        Cartesian3.normalize(direction, direction);
                    }
                }

                const viewDistance = distance !== undefined ? distance : Math.max(10000, (alt || 0) * 2 + 20000);

                let destination: Cartesian3;
                let orientation: any;

                if (heading !== undefined) {
                    const headingRad = CesiumMath.toRadians(heading);

                    // Offset in ENU frame at the target
                    const x_dir = Math.cos(pitch) * Math.sin(headingRad);
                    const y_dir = Math.cos(pitch) * Math.cos(headingRad);
                    const z_dir = Math.sin(pitch);

                    const offsetENU = new Cartesian3(
                        -x_dir * viewDistance,
                        -y_dir * viewDistance,
                        -z_dir * viewDistance
                    );

                    const enuTransform = Transforms.eastNorthUpToFixedFrame(targetPosition);
                    const offsetWC = Matrix4.multiplyByPointAsVector(enuTransform, offsetENU, new Cartesian3());
                    destination = Cartesian3.add(targetPosition, offsetWC, new Cartesian3());

                    orientation = {
                        heading: headingRad,
                        pitch,
                        roll: 0
                    };
                } else {
                    // Offset backwards by its looking direction
                    const offset = Cartesian3.multiplyByScalar(direction, -viewDistance, new Cartesian3());
                    destination = Cartesian3.add(targetPosition, offset, new Cartesian3());

                    // Keep roll at 0 by using the Earth's local normal to force a horizontal right vector
                    const localUp = Ellipsoid.WGS84.geodeticSurfaceNormal(destination, new Cartesian3());
                    const right = Cartesian3.cross(direction, localUp, new Cartesian3());
                    Cartesian3.normalize(right, right);

                    // The new 'up' vector will be perpendicular to both, ensuring 0 roll
                    const up = Cartesian3.cross(right, direction, new Cartesian3());
                    Cartesian3.normalize(up, up);

                    orientation = {
                        direction,
                        up,
                    };
                }

                let finalDestination = destination;
                let finalOrientation = orientation;

                if (!Matrix4.equals(viewer.camera.transform, Matrix4.IDENTITY)) {
                    // During tracking locks, the camera operates in a custom transform.
                    // We must convert the WGS84 destination into the target's local coordinate frame.
                    const invTransform = Matrix4.inverseTransformation(viewer.camera.transform, new Matrix4());
                    finalDestination = Matrix4.multiplyByPoint(invTransform, destination, new Cartesian3());

                    if (orientation && orientation.direction) {
                        finalOrientation = {
                            direction: Matrix4.multiplyByPointAsVector(invTransform, orientation.direction, new Cartesian3()),
                            up: Matrix4.multiplyByPointAsVector(invTransform, orientation.up, new Cartesian3()),
                        }
                    }
                    // HPR is intrinsically bound to the local reference frame so it passes through cleanly
                }

                viewer.camera.flyTo({
                    destination: finalDestination,
                    orientation: finalOrientation,
                    duration: 2.0,
                    easingFunction: EasingFunction.QUINTIC_IN_OUT,
                    complete: () => {
                        showSearchPin(viewer, lat, lon);
                    },
                });
            }, 50);
        });

        // Re-centre on a point while keeping the visible extent identical, so
        // "at my current zoom level" means exactly that.
        //
        // Implemented by rebuilding the CURRENT view rectangle around the new
        // centre and flying to that, rather than reusing the camera height.
        // Height alone does not determine what is visible once the camera is
        // tilted, and Cesium centres a Rectangle destination for us, so this
        // both preserves the zoom and guarantees the point ends up centred.
        const unsubCenterOn = dataBus.on("cameraCenterOn", ({ lat, lon }) => {
            if (!viewer || viewer.isDestroyed()) return;

            const current = viewer.camera.computeViewRectangle();
            if (current) {
                const halfWidth = Rectangle.computeWidth(current) / 2;
                const halfHeight = Rectangle.computeHeight(current) / 2;
                const centreLon = CesiumMath.toRadians(lon);
                const centreLat = CesiumMath.toRadians(lat);
                viewer.camera.flyTo({
                    destination: new Rectangle(
                        centreLon - halfWidth,
                        Math.max(centreLat - halfHeight, -CesiumMath.PI_OVER_TWO),
                        centreLon + halfWidth,
                        Math.min(centreLat + halfHeight, CesiumMath.PI_OVER_TWO),
                    ),
                    duration: 1.5,
                });
                return;
            }

            // computeViewRectangle returns undefined when the camera is not
            // looking at the globe (fully zoomed out, or mid-morph). Fall back
            // to the camera's own height.
            const height = viewer.camera.positionCartographic?.height;
            if (!Number.isFinite(height)) return;
            viewer.camera.flyTo({
                destination: Cartesian3.fromDegrees(lon, lat, height),
                duration: 1.5,
            });
        });

        const unsubFlyToBbox = dataBus.on("cameraFlyToBbox", ({ west, south, east, north }) => {
            setTimeout(() => {
                if (!viewer || viewer.isDestroyed()) return;
                viewer.camera.flyTo({
                    destination: Rectangle.fromDegrees(west, south, east, north),
                    duration: 1.5,
                    easingFunction: EasingFunction.QUINTIC_IN_OUT,
                });
            }, 50);
        });

        return () => {
            unsubFace();
            unsubGoTo();
            unsubCenterOn();
            unsubFlyToBbox();
        };
    }, [viewer, isReady]);
}
