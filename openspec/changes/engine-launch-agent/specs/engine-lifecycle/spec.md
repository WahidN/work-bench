## Purpose

Lets the app keep the engine running without the user starting it by hand, and makes an engine that is not running say so instead of quietly presenting empty screens.

## ADDED Requirements

### Requirement: The app reports whether the engine is reachable

The app SHALL determine whether the engine is reachable and present that state to the user. When the engine is not reachable, the app SHALL say so in a way that is visible from any screen, and SHALL NOT present an unreachable engine as an absence of data.

The message SHALL offer to start the engine when a managed agent is installed, and SHALL direct the user to the Engine settings when one is not.

#### Scenario: The engine is not running when the app opens

- **WHEN** the app opens and nothing is listening for the engine
- **THEN** the app shows that the engine is not reachable
- **AND** the Jira, Pull requests and Today screens do not merely appear empty

#### Scenario: The engine stops while the app is open

- **WHEN** the engine exits while the user is working
- **THEN** the app shows that the engine is not reachable within one minute
- **AND** the notice disappears on its own once the engine is reachable again

#### Scenario: The engine is reachable

- **WHEN** the engine is running
- **THEN** no notice about reachability is shown

### Requirement: The user can install a managed engine

The app SHALL be able to install a managed engine that starts when the user logs in, restarts if the engine process exits, and keeps running after the app quits. Installing SHALL require no terminal.

Installing SHALL be refused, with the reason given, when the engine directory has not been chosen, when that directory does not contain an engine, or when something is already listening on the engine's port. The last case matters because a managed engine that cannot bind its port would otherwise be restarted forever.

The app SHALL record where the engine's output goes, so that a managed engine which fails to start can be diagnosed.

#### Scenario: Installing for the first time

- **WHEN** the user has chosen a valid engine directory, nothing is listening on the port, and they choose to install
- **THEN** the managed engine is installed and started
- **AND** the app becomes able to reach the engine without further action

#### Scenario: Installing while an engine is already running

- **WHEN** the user chooses to install while a hand-started engine holds the port
- **THEN** installation is refused
- **AND** the app explains that the running engine must be stopped first

#### Scenario: Installing without an engine directory

- **WHEN** the user chooses to install before choosing a directory
- **THEN** installation is refused
- **AND** the app asks for the directory

#### Scenario: Installing with a directory that holds no engine

- **WHEN** the chosen directory does not contain an engine
- **THEN** installation is refused
- **AND** the app says the directory does not look like the engine

### Requirement: The user can remove the managed engine

The app SHALL be able to remove a managed engine it installed, stopping it and preventing it from starting at the next login. Removing SHALL leave no managed engine behind, and SHALL succeed even when the engine process has already stopped.

Removing SHALL NOT delete the engine directory, the database, or any credential.

#### Scenario: Removing a managed engine

- **WHEN** the user removes the managed engine
- **THEN** the engine stops
- **AND** it does not start at the next login
- **AND** the Engine settings offer to install it again

#### Scenario: Removing when the process has already died

- **WHEN** the user removes the managed engine while its process is not running
- **THEN** removal succeeds without an error

### Requirement: The engine directory is chosen once and remembered

The app SHALL let the user choose the engine directory with a folder picker and SHALL remember it across launches. The app SHALL NOT assume the engine sits at a fixed path relative to itself, because the built app has no reliable relationship to the checkout it came from.

The app SHALL show which directory is currently chosen.

#### Scenario: Choosing the directory

- **WHEN** the user picks a directory containing the engine
- **THEN** the app remembers it and shows it in the Engine settings
- **AND** the choice survives quitting and reopening the app

#### Scenario: The remembered directory has been moved away

- **WHEN** the remembered directory no longer contains an engine
- **THEN** the Engine settings say so
- **AND** installing is refused until a valid directory is chosen

### Requirement: A managed engine runs with the user's own tool versions

A managed engine SHALL run with the same interpreter and package manager the user would get in their own shell. An application launched from the desktop inherits a minimal environment in which the user's Node and package manager are not present, so the managed engine SHALL NOT depend on that inherited environment.

#### Scenario: The user's tools are not on the default path

- **WHEN** the managed engine starts and the user's Node lives somewhere only their shell configuration knows about
- **THEN** the engine still starts
- **AND** it uses the same versions the user's shell would use

#### Scenario: The user's Node is a version-manager shim

- **WHEN** the `node` on the user's shell path is a version-manager shim rather than a real executable
- **THEN** the managed engine runs the real executable that shim stands for
- **AND** starting the engine does not require any shim to work outside a terminal
