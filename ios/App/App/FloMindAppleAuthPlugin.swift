import AuthenticationServices
import Capacitor
import UIKit

@objc(FloMindAppleAuthPlugin)
public class FloMindAppleAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "FloMindAppleAuthPlugin"
    public let jsName = "FloMindAppleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]

    private var activeCall: CAPPluginCall?

    @objc func signIn(_ call: CAPPluginCall) {
        guard #available(iOS 13.0, *) else {
            call.reject("Sign in with Apple requires iOS 13 or later.")
            return
        }

        activeCall = call

        DispatchQueue.main.async {
            let provider = ASAuthorizationAppleIDProvider()
            let request = provider.createRequest()
            request.requestedScopes = [.fullName, .email]

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = activeCall else { return }
        activeCall = nil

        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            call.reject("Invalid Apple credential.")
            return
        }

        guard
            let identityTokenData = credential.identityToken,
            let identityToken = String(data: identityTokenData, encoding: .utf8)
        else {
            call.reject("Missing Apple identity token.")
            return
        }

        let authorizationCode = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        var fullName: [String: String] = [:]

        if let name = credential.fullName {
            if let givenName = name.givenName, !givenName.isEmpty {
                fullName["givenName"] = givenName
            }
            if let middleName = name.middleName, !middleName.isEmpty {
                fullName["middleName"] = middleName
            }
            if let familyName = name.familyName, !familyName.isEmpty {
                fullName["familyName"] = familyName
            }
            if let nickname = name.nickname, !nickname.isEmpty {
                fullName["nickname"] = nickname
            }
        }

        call.resolve([
            "identityToken": identityToken,
            "authorizationCode": authorizationCode,
            "userIdentifier": credential.user,
            "email": credential.email ?? "",
            "fullName": fullName
        ])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = activeCall else { return }
        activeCall = nil

        call.reject(error.localizedDescription)
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }

        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
