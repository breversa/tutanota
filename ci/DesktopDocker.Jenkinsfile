pipeline {
    environment {
    	// on m1 macs, this is a symlink that must be updated. see wiki.
        VERSION = sh(returnStdout: true, script: "${env.NODE_PATH}/node -p -e \"require('./package.json').version\" | tr -d \"\n\"")
        TMPDIR='/tmp'
    }

	agent {
		label 'linux'
	}

    stages {
		stage('docker') {
// 			agent {
// 				docker {
// 					image 'node'
// 					label 'linux'
// 				} // docker
// 			} // agent
			steps {
			    sh 'printenv'
			    script  {
			        def ci = sh(returnStdout: true, script: "sudo podman run -t -d hello-world")
// 			        sh("docker exec -t $ci node -v")
			    }
			} // steps
		} // stage
	} // stages
} // pipeline
