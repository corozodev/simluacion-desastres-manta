import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val signingFile = rootProject.file("key.properties")
val releaseSigning = Properties().apply {
    if (signingFile.exists()) signingFile.inputStream().use { load(it) }
}
if (gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }) {
    check(signingFile.exists()) { "Falta android/key.properties para firmar el APK de distribución." }
    listOf("storeFile", "storePassword", "keyAlias", "keyPassword").forEach {
        check(!releaseSigning.getProperty(it).isNullOrBlank()) { "Falta $it en android/key.properties." }
    }
}

android {
    namespace = "dev.corodev.spooky"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "dev.corodev.spooky"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (signingFile.exists()) {
            create("distribution") {
                storeFile = rootProject.file(releaseSigning.getProperty("storeFile"))
                storePassword = releaseSigning.getProperty("storePassword")
                keyAlias = releaseSigning.getProperty("keyAlias")
                keyPassword = releaseSigning.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("distribution")
        }
    }
}

flutter {
    source = "../.."
}
