pipeline {
    environment {
    	// on m1 macs, this is a symlink that must be updated. see wiki.
        NODE_MAC_PATH = '/usr/local/opt/node@20/bin/'
        VERSION = sh(returnStdout: true, script: "${env.NODE_PATH}/node -p -e \"require('./package.json').version\" | tr -d \"\n\"")
        CONTAINER_HOST='unix:///run/podman/podman.sock'
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

//     agent {
//     	docker {
//     		image 'node:20.15.1-alpine3.20'
// //     		label 'node'
//     	}
// // 		dockerfile {
// // 			filename 'ci/Desktop.dockerfile'
// // 			label 'linux'
// // 		}
//     }

	agent {
		label 'linux'
	}

    stages {
		stage('ls') {
			steps {
// 				sh  'ls -l /var'
// 				sh 'ls -l /var/tmp'
				sh 'docker -v'
				sh 'docker stop --all -t 1'
				sh 'docker rm --all'
				script {
					def cid = sh(returnStdout: true, script: 'docker run -t -d -u 7009:7009 node:20.15.1-alpine3.20 cat').trim()
					sh 'docker ps'
					sh "docker top $cid"
					sh "docker top --help"
					sh "docker top $cid -eo pid,comm"
				}
// 				sh 'node -v'
			} // steps
		} // stage
		stage('docker') {
			agent  {
				docker {
					image 'node:20.15.1-alpine3.20'
				}
			}
			steps {
				sh 'node -v'
			}
		}
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
