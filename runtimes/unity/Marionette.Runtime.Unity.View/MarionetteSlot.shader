// An unlit, vertex-color-tinted sprite shader for Marionette slot geometry. It multiplies the atlas texel
// by the per-vertex LIGHT tint (slot color x attachment color, with the resolved alpha in the vertex color
// alpha). The blend mode is a MATERIAL property (_SrcBlend / _DstBlend), so one shader serves all four slot
// blend modes: duplicate the material and set the factors per the table below.
//
//   normal   : SrcBlend One,      DstBlend OneMinusSrcAlpha   (premultiplied-over; alpha premultiplied in fragment)
//   additive : SrcBlend One,      DstBlend One
//   multiply : SrcBlend DstColor, DstBlend OneMinusSrcAlpha
//   screen   : SrcBlend One,      DstBlend OneMinusSrcColor
//
// The fragment premultiplies rgb by alpha so the normal path is correct straight-alpha compositing and the
// additive path (alpha 0 texels contribute nothing) behaves. No lighting, no shadows: this is 2D presentation.
Shader "Marionette/Slot"
{
    Properties
    {
        _MainTex ("Atlas Page", 2D) = "white" {}
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend ("Src Blend", Float) = 1
        [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend ("Dst Blend", Float) = 10
    }

    SubShader
    {
        Tags { "Queue" = "Transparent" "IgnoreProjector" = "True" "RenderType" = "Transparent" }
        Cull Off
        Lighting Off
        ZWrite Off
        Blend [_SrcBlend] [_DstBlend]

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                fixed4 color : COLOR;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                fixed4 color : COLOR;
            };

            sampler2D _MainTex;
            float4 _MainTex_ST;

            v2f vert (appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.color = v.color;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 texel = tex2D(_MainTex, i.uv);
                fixed4 c = texel * i.color;
                // Premultiply so the material blend factors composite straight-alpha content correctly.
                c.rgb *= c.a;
                return c;
            }
            ENDCG
        }
    }
}
