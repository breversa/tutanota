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
				sh 'whoami'
			    sh 'printenv'
			    sh 'groups'
			    sh 'ls /sys/fs/cgroup/machine.slice'
			    sh 'findmnt -R /sys/fs/cgroup'
			    script  {
			        def ci = sh(returnStdout: true, script: "podman ps --all")
// 			        sh("docker exec -t $ci node -v")
			    }
			} // steps
		} // stage
	} // stages
} // pipeline
