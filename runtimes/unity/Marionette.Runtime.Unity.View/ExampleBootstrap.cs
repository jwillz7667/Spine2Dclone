#if UNITY_2021_3_OR_NEWER
using UnityEngine;

namespace Marionette.Runtime.Unity.View
{
    // A minimal, code-only example that wires a SkeletonRenderer at runtime, so the package ships a working
    // reference without a fragile committed .unity scene asset. Attach this to an empty GameObject in a new
    // scene, assign the document JSON, the atlas page texture(s), and the four slot materials in the
    // inspector, then press Play: it frames an orthographic camera on the rig and starts the named animation.
    // The equivalent hand-built scene is described in the package README.
    [AddComponentMenu("Marionette/Example Bootstrap")]
    public sealed class ExampleBootstrap : MonoBehaviour
    {
        [SerializeField]
        private TextAsset documentJson;

        [SerializeField]
        private Texture2D[] atlasPages = System.Array.Empty<Texture2D>();

        [SerializeField]
        private Material normalMaterial;

        [SerializeField]
        private Material additiveMaterial;

        [SerializeField]
        private Material multiplyMaterial;

        [SerializeField]
        private Material screenMaterial;

        [SerializeField]
        private string skinName = "default";

        [SerializeField]
        private string animationName = "idle";

        [Tooltip("World-units half-height the orthographic camera frames. Rigs are authored around the "
            + "origin; raise this to zoom out.")]
        [SerializeField]
        private float cameraSize = 400f;

        private void Start()
        {
            Camera camera = Camera.main;
            if (camera == null)
            {
                var cameraObject = new GameObject("Main Camera") { tag = "MainCamera" };
                camera = cameraObject.AddComponent<Camera>();
            }

            camera.orthographic = true;
            camera.orthographicSize = cameraSize;
            camera.transform.position = new Vector3(0f, 0f, -10f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.1f, 0.1f, 0.12f, 1f);

            var skeletonObject = new GameObject("Skeleton");
            skeletonObject.transform.SetParent(transform, false);
            SkeletonRenderer renderer = skeletonObject.AddComponent<SkeletonRenderer>();
            renderer.SetInputs(
                documentJson,
                atlasPages,
                normalMaterial,
                additiveMaterial,
                multiplyMaterial,
                screenMaterial,
                skinName);
            renderer.Load();
            renderer.Play(animationName);
        }
    }
}
#endif
