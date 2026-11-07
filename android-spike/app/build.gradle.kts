plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.visionassist.spike"
    compileSdk = 35
    defaultConfig {
        applicationId = "org.visionassist.spike"
        minSdk = 33 // Android 13+: the question is screen-off camera on current phones
        targetSdk = 35
        versionCode = 1
        versionName = "spike"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    androidResources { noCompress += "onnx" }
}

dependencies {
    val camerax = "1.4.1"
    implementation("androidx.camera:camera-core:$camerax")
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")
}
