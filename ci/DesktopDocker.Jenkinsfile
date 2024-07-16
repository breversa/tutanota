pipeline {
    environment {
    	// on m1 macs, this is a symlink that must be updated. see wiki.
        NODE_MAC_PATH = '/usr/local/opt/node@20/bin/'
        VERSION = sh(returnStdout: true, script: "${env.NODE_PATH}/node -p -e \"require('./package.json').version\" | tr -d \"\n\"")
        TMPDIR=/tmp
    }

	agent {
		label 'linux'
	}

    stages {
		stage('docker') {
			agent  {
				docker {
					image 'node:20.15.1-alpine3.20'
					label 'linux'
				} // docker
			} // agent
			steps {
				sh 'node -v'
			} // steps
		} // stage
	} // stages
} // pipeline
