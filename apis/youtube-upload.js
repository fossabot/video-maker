const google = require('googleapis').google
const youtube = google.youtube({ version: 'v3'})
const OAuth2 = google.auth.OAuth2
const fs = require('fs')
const fastify = require('fastify')
const RxJS = require('rxjs')

module.exports = {
    authenticateWithOAuth,
    uploadThumbnail,
    uploadVideo
}

class OAuthConsentServer {
    contructor({ logger = true } = {}) {
        this.fastify = fastify({logger})
        this.observable = RxJS.from(new Promise((resolve, reject) => {
            this.fastify.get('/oauth2callback', (req, res) => {
                const authCode = req.query.code
                console.log(`> Consent given: ${authCode}`)

                resolve(authCode)
                res.send('<h1>Thank you!</h1><p>Now close this tab.</p>')
            })
        }))
    }
    async start(port = 5000) {
        await this.fastify.listen(port)
        console.log(`> Listening on http://localhost:${port}`)
    }
    async waitForGoogleCallback() {
        return this.observable.toPromise()
    }
    async stop() {
        this.fastify.close()
    }
}

async function authenticateWithOAuth() {
    const consentServer = new OAuthConsentServer() 
    await consentServer.start()
    const OAuthClient = await createOAuthClient()
    requestUserConsent(OAuthClient)
    const authorizationToken = await consentServer.waitForGoogleCallback()
    await setGlobalGoogleAuthentication(OAuthClient)
    const tokens = await requestGoogleForAccessTokens(OAuthClient, authorizationToken)
    OAuthClient.setCredentials(tokens)
    await consentServer.stop()
}

function createOAuthClient(credentials) {
    return new OAuth2(
        credentials.web.client_id,
        credentials.web.client_secret,
        credentials.web.redirect_uris[0]
    )
}
function requestUserConsent(OAuthClient) {
    const consentUrl = OAuthClient.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube']
    })
    console.log(`> Please give your consent: ${consentUrl}`)
}

async function requestGoogleForAccessTokens(OAuthClient, authorizationToken) {
    const tokens = await OAuthClient.getToken(authorizationToken)
    console.log('> Access tokens received:')
    console.log(tokens)
    return tokens
}

function setGlobalGoogleAuthentication(OAuthClient) {
    google.options({
        auth: OAuthClient
    })
}

async function uploadVideo({
    filePath,
    title,
    tags,
    description
  }) {
    const videoFileSize = fs.statSync(filePath).size
    const requestParameters = {
      part: 'snippet, status',
      requestBody: {
        snippet: { title, description, tags },
        status:  { privacyStatus: 'unlisted' }
      },
      media: { body: fs.createReadStream(filePath) }
    }
    const youtubeResponse = await youtube.videos.insert(requestParameters, {
      onUploadProgress: uploadProgressCurry(videoFileSize)
    })

    console.log(`> Video available at: https://youtu.be/${youtubeResponse.data.id}`)
    return youtubeResponse.data
}

async function uploadThumbnail(videoInformation, videoThumbnailFilePath) {
    const videoId = videoInformation.id
    const requestParameters = {
      videoId: videoId,
      media: {
        mimeType: 'image/jpeg',
        body: fs.createReadStream(videoThumbnailFilePath)
      }
    }

    const youtubeResponse = await youtube.thumbnails.set(requestParameters)
    console.log(`> Thumbnail uploaded!`)
    return youtubeResponse
}

function uploadProgressCurry(videoFileSize) {
    return event => {
        const progress = Math.round( (event.bytesRead / videoFileSize) * 100 )
        console.log(`> ${progress}% completed`)
    }
}
