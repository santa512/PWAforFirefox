import { Modal, Toast } from 'bootstrap'
import Tags from 'bootstrap5-tags/tags'

async function obtainUrls () {
  const tab = (await browser.tabs.query({ active: true, currentWindow: true }))[0]

  // Ask the content script to obtain the manifest and the document URL
  return await browser.tabs.sendMessage(tab.id, 'ObtainUrls')
}

async function obtainManifest (manifestUrl, documentUrl) {
  const manifestResponse = await fetch(manifestUrl)
  const manifest = await manifestResponse.json()

  // Parse the start URL with the manifest URL as a base
  // If it does not exist, set it to the document URL
  if (manifest.start_url) {
    manifest.start_url = new URL(manifest.start_url, documentUrl)
    manifest.start_url = manifest.start_url.href
  } else {
    manifest.start_url = documentUrl
  }

  // Parse the scope with the manifest URL as a base
  // If it does not exist, set it to the `.` with the start URL as a base
  if (manifest.scope) {
    manifest.scope = new URL(manifest.scope, documentUrl)
    manifest.scope = manifest.scope.href
  } else {
    manifest.scope = new URL('.', manifest.start_url)
    manifest.scope = manifest.scope.href
  }

  // Check if the start URL is the same origin as document URL and is within the scope
  const _startUrl = new URL(manifest.start_url)
  const _scopeUrl = new URL(manifest.scope)
  const _documentUrl = new URL(documentUrl)

  if (_startUrl.origin !== _documentUrl.origin) throw new Error('Start and document URL are not in the same origin')
  if (_startUrl.origin !== _scopeUrl.origin || !_startUrl.pathname.startsWith(_scopeUrl.pathname)) throw new Error('Start URL is not within the scope')

  // Return the validated and parsed manifest
  return manifest
}

async function obtainSiteList () {
  const response = await browser.runtime.sendNativeMessage('firefoxpwa', { cmd: 'GetSiteList' })

  // Handle native connection errors
  if (response.type === 'Error') throw new Error(response.data)
  if (response.type !== 'SiteList') throw new Error(`Received invalid response type: ${response.type}`)

  // Return the site list
  return response.data
}

async function obtainProfileList () {
  const response = await browser.runtime.sendNativeMessage('firefoxpwa', { cmd: 'GetProfileList' })

  // Handle native connection errors
  if (response.type === 'Error') throw new Error(response.data)
  if (response.type !== 'ProfileList') throw new Error(`Received invalid response type: ${response.type}`)

  // Return the site list
  return response.data
}

async function initializeForm () {
  const form = document.getElementById('web-app-form')
  const submit = document.getElementById('web-app-submit')

  // Create tags input
  for (const element of document.querySelectorAll('.form-select-tags')) {
    element.tagsInstance = new Tags(element)
  }

  // Obtain manifest for the current site
  const { manifest: manifestUrl, document: documentUrl } = await obtainUrls()
  const manifest = await obtainManifest(manifestUrl, documentUrl)

  // Obtain a list of existing sites and profiles
  let sites
  let profiles
  try {
    sites = await obtainSiteList()
    profiles = await obtainProfileList()
  } catch (error) {
    console.error(error)

    document.getElementById('error-text').innerText = error.message
    Toast.getOrCreateInstance(document.getElementById('error-toast')).show()

    return
  }

  // Determine web app name from the manifest name, short name or scope host
  let name = manifest.name
  if (!name) name = manifest.short_name
  if (!name) name = new URL(manifest.scope).host

  // Determine web app description from the manifest description or fallback to an empty string
  const description = manifest.description || ''

  // Set web app data to inputs
  document.getElementById('web-app-name').setAttribute('placeholder', name)
  document.getElementById('web-app-description').setAttribute('placeholder', description)
  document.getElementById('web-app-start-url').setAttribute('placeholder', manifest.start_url)

  const categoriesElement = document.getElementById('web-app-categories')
  for (const category of manifest.categories || []) categoriesElement.tagsInstance.addItem(category, category)

  const keywordsElement = document.getElementById('web-app-keywords')
  for (const keyword of manifest.keywords || []) keywordsElement.tagsInstance.addItem(keyword, keyword)

  // Add available profiles to the select input
  const profilesElement = document.getElementById('web-app-profile')
  for (const profile of Object.values(profiles)) profilesElement.add(new Option(profile.name || profile.ulid, profile.ulid))

  // Add an option to create a new profile to the select input
  profilesElement.add(new Option('Create a new profile', 'create-new-profile'))

  // Handle creating a new profile
  let lastProfileSelection = profilesElement.value
  profilesElement.addEventListener('change', function (event) {
    if (this.value !== 'create-new-profile') {
      lastProfileSelection = this.value
      return
    }

    Modal.getOrCreateInstance(document.getElementById('new-profile-modal'), { backdrop: 'static', keyboard: false }).show()
    event.preventDefault()
  })

  document.getElementById('new-profile-cancel').addEventListener('click', function () {
    profilesElement.value = lastProfileSelection
  })

  document.getElementById('new-profile-create').addEventListener('click', async function () {
    const name = document.getElementById('new-profile-name').value || null
    const description = document.getElementById('new-profile-description').value || null
    let id

    this.disabled = true
    this.innerText = 'Creating...'

    // Create a new profile and get its ID
    try {
      const response = await browser.runtime.sendNativeMessage('firefoxpwa', {
        cmd: 'CreateProfile',
        params: { name, description }
      })

      if (response.type === 'Error') throw new Error(response.data)
      if (response.type !== 'ProfileCreated') throw new Error(`Received invalid response type: ${response.type}`)

      Toast.getOrCreateInstance(document.getElementById('error-toast')).hide()
      id = response.data
    } catch (error) {
      console.error(error)

      document.getElementById('error-text').innerText = error.message
      Toast.getOrCreateInstance(document.getElementById('error-toast')).show()
    }

    // Create a new option in the select input and select it
    profilesElement.add(new Option(name, id, true, true))

    // Hide the modal
    Modal.getOrCreateInstance(document.getElementById('new-profile-modal'), { backdrop: 'static', keyboard: false }).hide()
  })

  // Set form to be validated after all inputs are filled with default values and enable submit button
  form.classList.add('was-validated')
  submit.disabled = false
  submit.innerText = 'Install web app'

  // Validate the name input
  const nameValidation = function () {
    const invalidLabel = document.getElementById('web-app-name-invalid')
    const nameInput = document.getElementById('web-app-name')

    const currentName = nameInput.value || nameInput.getAttribute('placeholder')
    const existingNames = Object.values(sites).map(site => site.config.name || site.manifest.name || site.manifest.short_name)

    // If the name is already used for existing sites, this will cause problems
    if (existingNames.includes(currentName)) {
      this.setCustomValidity('Site name must not be reused from existing web apps')
      invalidLabel.innerText = this.validationMessage
      return
    }

    this.setCustomValidity('')
  }

  const nameInput = document.getElementById('web-app-name')
  nameInput.addEventListener('input', nameValidation)
  nameValidation.call(nameInput)

  // Validate start URL input
  const startUrlValidation = function () {
    const invalidLabel = document.getElementById('web-app-start-url-invalid')

    // Empty URL defaults to manifest start URL
    if (!this.value) {
      this.setCustomValidity('')
      return
    }

    // Start URL needs to be a valid URL
    if (this.validity.typeMismatch) {
      this.setCustomValidity('Start URL needs to be a valid URL')
      invalidLabel.innerText = this.validationMessage
      return
    }

    // Start URL needs to be within the scope
    const startUrl = new URL(this.value)
    const scope = new URL(manifest.scope)
    if (startUrl.origin !== scope.origin || !startUrl.pathname.startsWith(scope.pathname)) {
      this.setCustomValidity(`Start URL needs to be within the scope: ${scope}`)
      invalidLabel.innerText = this.validationMessage
      return
    }

    // All checks passed
    this.setCustomValidity('')
  }

  const startUrlInput = document.getElementById('web-app-start-url')
  startUrlInput.addEventListener('input', startUrlValidation)
  startUrlValidation.call(startUrlInput)

  // Handle form submission and validation
  submit.onclick = async (event) => {
    event.preventDefault()
    event.stopPropagation()

    // Validate the form using built-in browser validation
    if (!form.checkValidity()) return

    // Change button to progress
    submit.disabled = true
    submit.innerText = 'Installing web app...'

    // Get simple site data
    const startUrl = document.getElementById('web-app-start-url').value || null
    const profile = document.getElementById('web-app-profile').value || null
    const name = document.getElementById('web-app-name').value || null
    const description = document.getElementById('web-app-description').value || null

    // Get categories and keywords based on user form input and site manifest
    // If the user list is identical to the manifest, ignore it, otherwise, set it as a user overwrite
    const userCategories = [...document.getElementById('web-app-categories').selectedOptions].map(option => option.value)
    const manifestCategories = manifest.categories
    const categories = userCategories.toString() !== manifestCategories.toString() ? userCategories : []

    const userKeywords = [...document.getElementById('web-app-keywords').selectedOptions].map(option => option.value)
    const manifestKeywords = manifest.keywords
    const keywords = userKeywords.toString() !== manifestKeywords.toString() ? userKeywords : []

    // Tell the native connector to install the site
    try {
      const response = await browser.runtime.sendNativeMessage('firefoxpwa', {
        cmd: 'InstallSite',
        params: {
          manifest_url: manifestUrl,
          document_url: documentUrl,
          start_url: startUrl,
          profile: profile,
          name: name,
          description: description,
          categories,
          keywords
        }
      })

      // Handle native connection errors
      if (response.type === 'Error') throw new Error(response.data)
      if (response.type !== 'SiteInstalled') throw new Error(`Received invalid response type: ${response.type}`)

      // Hide error toast
      Toast.getOrCreateInstance(document.getElementById('error-toast')).hide()

      // Change button to success
      submit.disabled = true
      submit.innerText = 'Web app installed!'

      // Close the popup after some time
      setTimeout(() => {
        window.close()
      }, 5000)
    } catch (error) {
      console.error(error)

      document.getElementById('error-text').innerText = error.message
      Toast.getOrCreateInstance(document.getElementById('error-toast')).show()
    }
  }
}

initializeForm()
