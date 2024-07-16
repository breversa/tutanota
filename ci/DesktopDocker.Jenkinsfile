pipeline {
    environment {
    	// on m1 macs, this is a symlink that must be updated. see wiki.
        NODE_MAC_PATH = '/usr/local/opt/node@20/bin/'
        VERSION = sh(returnStdout: true, script: "${env.NODE_PATH}/node -p -e \"require('./package.json').version\" | tr -d \"\n\"")
    }
    options {
        preserveStashes()
    }

    parameters {
        booleanParam(
            name: 'RELEASE',
            defaultValue: false,
            description: "Prepare a release version (doesn't publish to production, this is done manually)"
        )
		persistentText(
			name: "releaseNotes",
			defaultValue: "",
			description: "release notes for this build"
		 )
    }

    agent {
		dockerfile {
			filename 'ci/Desktop.dockerfile'
			label 'linux'
		}
    }

    stages {
		stage('test') {
			steps {
				sh 'ls'
				sh 'node -v'
			} // steps
		} // stage
	} // stages
} // pipeline

void initBuildArea() {
	sh 'node -v'
	sh 'npm -v'
    sh 'npm ci'
    sh 'npm run build-packages'
    sh 'rm -rf ./build/*'
    sh 'rm -rf ./native-cache/*'
    unstash 'web_base'
}
